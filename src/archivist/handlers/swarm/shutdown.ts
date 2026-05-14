// charter: dispatch
// swarm_shutdown mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers as `GuardedWrite<SwarmShutdownPayload>` because shutdown is the
// most-destructive swarm transition: it flips `target.status = 'terminated'`,
// reaps the agent roster, and persists the updated `SwarmState` — every
// shutdown MUST flow through the audit chain (intent → applied | rejected)
// with guard verdicts + invariant verdicts.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/swarm-tools.ts`
// `swarm_shutdown` handler (lines 413-467) — load → resolve target swarm
// (explicit `swarmId` else most-recently-updated `status === 'running'`) →
// guard `already-terminated` → flip status → bump `updatedAt` →
// `saveSwarmStore`. The cli callsite stays in place until the dispatch
// boundary is wired through cli (mirroring memory_store, hive-mind_spawn
// pending wire-up). This file establishes the registration shape the
// dispatch path will resolve.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// swarm coordination state may mutate. Direct fs writes are forbidden by the
// `no-restricted-imports` backstop and the path-restricted
// substrate-internal.ts seam (ADR-0180 §Type enforcement). Production wire-up
// instantiates the FS-JSON store via `makeFsJsonSubstrate` from
// `archivist/substrates` — the substrate's O_EXCL sentinel lock subsumes the
// legacy `withSwarmStoreLock` because the migrated wire-up routes the swarm
// store through the same primitive.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/**
 * Mutation payload mirroring the CLI tool's `swarm_shutdown` input shape
 * (swarm-tools.ts:418-422). Both fields are optional: an absent `swarmId`
 * selects the most-recently-updated `status === 'running'` swarm (cli's
 * `running[0]` fall-through); `graceful` defaults to `true` at the wire-up
 * callsite.
 */
export interface SwarmShutdownPayload {
  readonly swarmId?: string;
  readonly graceful?: boolean;
}

const STORE_ID = 'swarm_shutdown' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of swarm-tools.ts
// `swarm_shutdown` handler (resolve `target` via explicit `swarmId` lookup
// or the most-recently-updated-running fall-through, guard the
// already-terminated branch, flip `target.status='terminated'` and
// `target.updatedAt`, persist via `saveSwarmStore`). The cli's
// `withSwarmStoreLock` collapses to a single `ctx.substrate.withWrite` here
// because the substrate primitive owns the lock semantics. Agent-roster reap
// dispatches through the agents.json store's own mutation handler
// (out-of-scope here, in scope for invariants-author).
export const shutdownSwarmHandler: GuardedWrite<SwarmShutdownPayload> =
  registerMutationHandler<SwarmShutdownPayload>(
    'swarm_shutdown',
    async (ctx: MutationContext<false>, _payload: SwarmShutdownPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: swarm_shutdown handler body pending Phase 5 wire-up; ' +
          'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/swarm-tools.ts swarm_shutdown handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
