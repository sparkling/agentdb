// charter: dispatch
// hive-mind_shutdown mutation handler (ADR-0180 Phase 4, §Architecture · Audit chain).
// Registers as `GuardedWrite<HiveMindShutdownPayload>` because shutdown is the
// most-destructive hive transition: it terminates all workers, clears queen +
// workers + consensus.pending + sharedMemory, flips `initialized = false`, and
// persists the cleared state — every shutdown MUST flow through the audit chain
// (intent → applied | rejected) with guard verdicts + invariant verdicts.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/hive-mind-tools.ts`
// `hive-mind_shutdown` handler (lines 2851-2929) — load → guard-pending-
// consensus → clear workers from agents.json → reset hive state fields →
// `saveHiveState` under `withHiveStoreLock` → `stopHiveMindSweepTimer`. The
// cli callsite stays in place until the dispatch boundary is wired through
// cli (mirroring memory_store, hive-mind_broadcast, hive-mind_memory pending
// wire-up). This file establishes the registration shape the dispatch path
// will resolve.
//
// Cross-store mutation: shutdown mutates BOTH `hive-mind_shutdown` (hive
// state) AND the agents.json store (worker termination). The agents.json
// fan-out is intrinsic to shutdown semantics — `state.workers[]` references
// agent ids that must be reaped together to avoid orphaned agent records
// (ADR-0129 B1 serialization is the cli's current safety net). Post wire-up,
// the handler body collapses to a single `ctx.substrate.withWrite` over the
// hive store; the agents.json reap dispatches through that store's own
// mutation handler (out-of-scope here, in scope for invariants-author).
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// hive shutdown state may mutate. Direct fs writes are forbidden by the
// `no-restricted-imports` backstop and the path-restricted
// substrate-internal.ts seam (ADR-0180 §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/** Mutation payload mirroring the cli tool's input shape (hive-mind-tools.ts
 *  inputSchema lines 2854-2860). `graceful` defaults to true and `force`
 *  defaults to false at the wire-up callsite — the cli's pending-consensus
 *  guard fires when `graceful && !force && pendingConsensus > 0`. */
export interface HiveMindShutdownPayload {
  readonly graceful?: boolean;
  readonly force?: boolean;
}

const STORE_ID = 'hive-mind_shutdown' as StoreId;

// TODO(ADR-0180 Phase 4 wire-up): port the body of hive-mind-tools.ts
// `hive-mind_shutdown` callsite once the dispatch boundary is wired through
// cli. The cli's load → guard-pending → clear-workers → reset-state → save
// → stopSweepTimer sequence collapses to: (1) one `ctx.substrate.withWrite`
// over the hive store that resets `initialized/queen/workers/consensus.pending/
// sharedMemory`, (2) a dispatch to the agents.json store handler to reap the
// terminated workers, (3) `stopHiveMindSweepTimer()` as an out-of-band
// side-effect (timer lifecycle is process-local, not substrate state). The
// cli's outer `withHiveStoreLock` becomes redundant under the primitive's
// own lock semantics.
export const shutdownHiveMindHandler: GuardedWrite<HiveMindShutdownPayload> =
  registerMutationHandler<HiveMindShutdownPayload>(
    'hive-mind_shutdown',
    async (ctx: MutationContext<false>, _payload: HiveMindShutdownPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: hive-mind_shutdown handler body pending Phase 4 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/hive-mind-tools.ts hive-mind_shutdown handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
