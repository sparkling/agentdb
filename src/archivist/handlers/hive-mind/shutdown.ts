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
import type { HiveStateDoc } from './hive-state.js';

/** Mutation payload mirroring the cli tool's input shape (hive-mind-tools.ts
 *  inputSchema lines 2854-2860). `graceful` defaults to true and `force`
 *  defaults to false at the wire-up callsite — the cli's pending-consensus
 *  guard fires when `graceful && !force && pendingConsensus > 0`. */
export interface HiveMindShutdownPayload {
  readonly graceful?: boolean;
  readonly force?: boolean;
}

const STORE_ID = 'hive-mind_shutdown' as StoreId;

// Ported from cli/src/mcp-tools/hive-mind-tools.ts `hive-mind_shutdown` handler
// (lines 2881-2922). The cli's `load → guard-pending → clear-workers →
// reset-state → save under withHiveStoreLock` collapses to a single
// `ctx.substrate.withWrite` over the hive store — the substrate primitive
// owns the lock semantics.
//
// Scope: this handler resets the hive store only (`initialized`, `queen`,
// `workers`, `consensus.pending`, `sharedMemory`). Per this file's rationale
// block, the agents.json worker-reap is intrinsic to shutdown semantics but
// dispatches through the `hive-mind_agents` store's own mutation handler
// (`agents-json.ts`, action `'clear'`) once the dispatch boundary is wired —
// it is NOT fanned out from this handler body. `stopHiveMindSweepTimer()` is
// likewise an out-of-band process-local side-effect (timer lifecycle is not
// substrate state) the cli callsite still owns.
export const shutdownHiveMindHandler: GuardedWrite<HiveMindShutdownPayload> =
  registerMutationHandler<HiveMindShutdownPayload>(
    'hive-mind_shutdown',
    async (ctx: MutationContext<false>, payload: HiveMindShutdownPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const state = await handle.read<HiveStateDoc>({ storeId: STORE_ID, key: 'root' });
        if (!state || !state.initialized) {
          throw new Error('hive-mind_shutdown: hive-mind not initialized or already shut down');
        }

        const graceful = payload.graceful !== false;
        const force = payload.force === true;
        const pendingConsensus = state.consensus.pending.length;

        // Graceful shutdown with pending consensus requires an explicit force
        // override — fail loud rather than silently discarding pending work.
        if (graceful && pendingConsensus > 0 && !force) {
          throw new Error(
            `hive-mind_shutdown: cannot gracefully shutdown with ${pendingConsensus} ` +
              `pending consensus items — pass force: true to override`,
          );
        }

        // Reset hive state. `consensus.history` is intentionally preserved for
        // reference (mirrors the cli — only `pending` is cleared).
        state.initialized = false;
        delete state.queen;
        state.workers = [];
        state.consensus.pending = [];
        state.sharedMemory = {};

        await handle.write({ storeId: STORE_ID, key: 'root', payload: state });
      });
    },
    {
      // The natural invariant here (post-shutdown state has initialized=false,
      // zero workers, zero pending consensus) needs the substrate after-snapshot
      // the dispatch boundary does not yet populate (index.ts passes
      // `substrateStateAfter: undefined` pending the ADR-0180 snapshot wiring).
      // Authoring it now would false-positive on every dispatch — left to
      // invariants-author once the snapshot seam lands.
      invariants: [],
      cacheScope: 'global',
    },
  );
