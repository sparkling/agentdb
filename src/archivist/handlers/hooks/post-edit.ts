// charter: hot-path-fast-path
// `hook_post_edit` handler — replaces intelligence.cjs#recordEdit's
// `fs.appendFileSync` to `.claude-flow/data/pending-insights.jsonl` (line 662
// in @claude-flow/cli/.claude/helpers/intelligence.cjs).
//
// Hot-path discipline (ADR-0180 §Performance and hot paths + Open Follow-up #13):
//   - Registered with `{ hotPath: true }`. The dispatch envelope binds
//     `makeAuditSink(true)` (index.ts) so the intent/applied audit rows queue
//     onto the shared 256-entry `HotPathQueue` for microtask drain to the
//     write-through journal — `enqueue` returns synchronously, the caller's
//     stack never pays the fsync.
//   - `MutationContext<true>` types `child`/`bulk` as `never` — this handler
//     is a single leaf write (one-shot record append). No re-entrancy.
//   - Caller-observable budget: <2ms (intelligence.cjs#recordEdit's documented
//     contract). The synchronous cost the caller pays is the substrate leaf
//     write below + the audit enqueue; the journal write is off-stack.
//
// Substrate seam (F4-2 Phase A — live): `ctx.substrate` routes this handler's
// `STORE_ID` through the FS-JSON family substrate (substrate-registry.ts maps
// `hooks_post_edit` → `data/pending-insights.jsonl`). `handle.write` IS the
// journal-append substrate operation — no separate append-only-log primitive
// is needed; the FS-JSON substrate's atomic tmp+fsync+rename is the durability
// stack the cli's bare `appendFileSync` lacked.
//
// Wire-up to intelligence.cjs is F4-3 (deferred — cli stays authoritative
// until the dispatch surface lands).

import { registerMutationHandler } from '../../registration.js';
import type { StoreId } from '../../types.js';
import { postEditInvariants } from '../../invariants/hooks/post-edit.js';

export interface PostEditPayload {
  readonly file: string;
  readonly timestamp: number;
  readonly sessionId: string | null;
  readonly type: 'edit';
}

const STORE_ID = 'hooks_post_edit' as StoreId;

export const postEditHandler = registerMutationHandler<PostEditPayload>(
  'hook_post_edit',
  async (ctx, payload) => {
    // Hot-path contract: single leaf intent. No child(), no bulk() — both are
    // `never` on ctx. This is the JSONL row the cli previously appended
    // directly to pending-insights.jsonl via `fs.appendFileSync`.
    //
    // Key = `${timestamp}:${file}` — `timestamp` is millisecond wall-clock from
    // the call site so collisions within a single edit are not possible; `file`
    // disambiguates concurrent edits sharing a millisecond. The FS-JSON
    // substrate addresses `key` as a top-level field of the JSON document, so
    // each edit is an independently-addressable entry rather than an opaque
    // append — replay reads the document's fields, not a line scan.
    await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
      await handle.write({
        storeId: STORE_ID,
        key: `${payload.timestamp}:${payload.file}`,
        payload,
      });
    });
  },
  {
    hotPath: true,
    invariants: postEditInvariants,
    cacheScope: 'global',
  },
);
