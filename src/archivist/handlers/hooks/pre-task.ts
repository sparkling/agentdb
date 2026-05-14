// charter: hot-path-fast-path
// `hook_pre_task` handler — replaces the `session.metric('tasks')` counter
// increment performed by hook-handler.mjs at the pre-task lifecycle point.
//
// cli body inspected (canonical reference, do NOT guess the payload shape):
//   forks/ruflo/v3/@claude-flow/cli/.claude/helpers/hook-handler.mjs:214–223
//     'pre-task': () => {
//       if (session && session.metric) {
//         try { session.metric('tasks'); } catch { /* no active session */ }
//       }
//       if (router && router.routeTask && prompt) { ...routing... }
//     }
//   forks/ruflo/v3/@claude-flow/cli/.claude/helpers/session.js:111–123
//     `session.metric('tasks')` is a bare counter increment — bumps
//     `session.metrics.tasks++` in SESSION_FILE. No payload is captured.
//
// What the call site has in scope at pre-task: `prompt` (from stdin envelope
// `hookInput.prompt || hookInput.command || toolInput`), `toolName`, the
// session record's `id` (a `session-${Date.now()}` string), and wall-clock
// time. The router branch is a SEPARATE cold-path concern (cli stays
// authoritative for `routeTask` console output).
//
// Hot-path discipline (ADR-0180 §Performance and hot paths + Open Follow-up #13):
//   - Registered with `{ hotPath: true }`. The dispatch envelope binds
//     `makeAuditSink(true)` (index.ts) so the intent/applied audit rows queue
//     onto the shared 256-entry `HotPathQueue` for microtask drain — `enqueue`
//     returns synchronously, the journal write is off the caller's stack.
//   - `MutationContext<true>` types `child`/`bulk` as `never` — this handler
//     is a single leaf write (one-shot counter bump). No re-entrancy.
//   - Caller-observable budget: <2ms. The synchronous cost the caller pays is
//     the substrate leaf write below + the audit enqueue.
//
// Substrate seam (F4-2 Phase A — live): `ctx.substrate` routes `STORE_ID`
// through the FS-JSON family substrate (substrate-registry.ts maps
// `hooks_pre_task` → `data/intelligence-snapshot.json`). `handle.write` IS the
// counter-bump substrate operation — the FS-JSON document holds one entry per
// session key; the cli's bare `session.metrics.tasks++` becomes a recorded,
// atomically-persisted entry rather than an in-process side effect.
//
// Wire-up to hook-handler.mjs is F4-3 (deferred — cli stays authoritative
// until the dispatch surface lands).

import { registerMutationHandler } from '../../registration.js';
import type { StoreId } from '../../types.js';

export interface PreTaskPayload {
  readonly prompt: string;
  readonly toolName: string;
  readonly timestamp: number;
  readonly sessionId: string | null;
  readonly type: 'pre-task';
}

const STORE_ID = 'hooks_pre_task' as StoreId;

export const preTaskHandler = registerMutationHandler<PreTaskPayload>(
  'hook_pre_task',
  async (ctx, payload) => {
    // Hot-path contract: single leaf intent. No child(), no bulk() — both are
    // `never` on ctx. This mirrors the `session.metric('tasks')` increment the
    // cli previously performed in-process.
    //
    // Key = sessionId, with a 'global' fallback when no active session —
    // mirrors the cli's `catch { /* no active session */ }` branch. The
    // last-writer-wins document field carries the most recent pre-task payload
    // for the session; the durable per-task history is the audit chain (one
    // intent/applied pair per dispatch), not this field.
    await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
      await handle.write({
        storeId: STORE_ID,
        key: payload.sessionId ?? 'global',
        payload,
      });
    });
  },
  {
    hotPath: true,
    invariants: [],
    cacheScope: 'global',
  },
);
