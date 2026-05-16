// charter: dispatch
// daemon_runMap mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers the 15-minute scheduled `map` worker write as a
// `GuardedWrite<MapWorkerPayload>` so each codebase-map snapshot transition
// flows through the archivist's audit-chain (intent → applied | rejected) with
// guard verdicts + invariant verdicts recorded.
//
// Pre-existing daemon callsite: `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts`
// `runMapWorker` method (line 1321), reached via the scheduler entry
// `{ type: 'map', intervalMs: 15 * 60 * 1000, ... }` (line 107) and the
// dispatch switch at line 1237. The worker writes
// `.claude-flow/metrics/codebase-map.json` via `writeFileSync` — under
// ADR-0180 F4-3 the daemon callsite stays in place; this file establishes the
// registration shape the dispatch path will resolve once wired.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/metrics/codebase-map.json` may mutate. The underlying
// primitive is `makeFsJsonSubstrate` (substrates/fs-json-store.ts), shared
// across daemon worker writes under one cross-process O_EXCL sentinel lock.

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';

/**
 * Mutation payload for the daemon-scheduled codebase-map worker.
 *
 * The cli's `runMapWorker` (worker-daemon.ts:1400-1423) composes the snapshot
 * from four `existsSync` probes (`package.json`, `tsconfig.json`, `.claude`,
 * `.claude-flow`) — those are filesystem reads the *daemon* performs on its
 * own stack and are NOT a substrate concern (matches the `optimize.ts` /
 * `consolidate.ts` precedent: the cli runs the work, the handler owns
 * persistence only). So the snapshot arrives here fully-composed in the
 * payload; the handler writes it verbatim.
 *
 * The field set mirrors the cli snapshot 1:1 so the on-disk
 * `.claude-flow/metrics/codebase-map.json` schema is unchanged when the F4-3
 * dispatch wire-up flips `runMapWorker` to
 * `archivist.dispatch('daemon_runMap', snapshot)`.
 */
export interface MapWorkerPayload {
  /** ISO-8601 — `new Date().toISOString()` at the daemon tick. */
  readonly timestamp: string;
  /** Absolute project root the scan ran against. */
  readonly projectRoot: string;
  /** Marker-file presence — composed via four cli-side `existsSync` probes. */
  readonly structure: {
    readonly hasPackageJson: boolean;
    readonly hasTsConfig: boolean;
    readonly hasClaudeConfig: boolean;
    readonly hasClaudeFlow: boolean;
  };
  /** `Date.now()` at scan completion (epoch ms, mirrors cli field). */
  readonly scannedAt: number;
}

const STORE_ID = 'metrics_codebase_map' as StoreId;

// F4-2 body: snapshot is composed daemon-side (existsSync probes are
// filesystem reads, not a substrate concern — `optimize.ts` precedent) and
// arrives in the payload; this handler owns persistence only. One `withWrite`
// scope → one `handle.write` of the whole document. The cli
// `writeFileSync(.../codebase-map.json)` at worker-daemon.ts:1421 collapses
// to this call once F4-3 flips the daemon switch to
// `archivist.dispatch('daemon_runMap', snapshot)`.
export const mapWorkerHandler: GuardedWrite<MapWorkerPayload> =
  registerMutationHandler<MapWorkerPayload>(
    'daemon_runMap',
    async (ctx: MutationContext<false>, payload: MapWorkerPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        await handle.write({ storeId: STORE_ID, key: 'root', payload });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
