// charter: dispatch
// swarm_init mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers as `GuardedWrite<SwarmInitPayload>` so every swarm initialization
// transitions through the archivist's audit-chain (intent → applied | rejected)
// with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/swarm-tools.ts`
// `swarm_init` handler (line 215) — validates topology against
// VALID_TOPOLOGIES, clamps `maxAgents` to [1,50], applies ADR-0098 7-day
// dedupe TTL over `loadSwarmStore()` under `withSwarmStoreLock`, optionally
// force-creates a fresh swarm with an `audit`-logged `reason`, and persists
// the resulting `SwarmState` via `saveSwarmStore`. The cli callsite stays in
// place until the dispatch boundary is wired through cli (mirroring
// memory_store, hive-mind_spawn pending wire-up). This file establishes the
// registration shape the dispatch path will resolve.
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

/** Topology variants — mirrors swarm-tools.ts:206-208 (`VALID_TOPOLOGIES`). */
export type SwarmTopology =
  | 'hierarchical'
  | 'mesh'
  | 'hierarchical-mesh'
  | 'ring'
  | 'star'
  | 'hybrid'
  | 'adaptive';

/** Agent strategy — mirrors the cli `strategy` default `'specialized'` (swarm-tools.ts:232). */
export type SwarmStrategy = 'specialized' | 'balanced' | 'adaptive';

/**
 * Mutation payload mirroring the CLI tool's `swarm_init` input shape
 * (swarm-tools.ts:218-228). Defaults applied at the wire-up callsite:
 * `topology='hierarchical-mesh'`, `maxAgents=15` (clamped to [1,50]),
 * `strategy='specialized'`, `force=false`. The advisory warning fires when
 * `force=true && reason===undefined` (Flaw 4 mitigation, swarm-tools.ts:244-250).
 */
export interface SwarmInitPayload {
  readonly topology?: SwarmTopology;
  readonly maxAgents?: number;
  readonly strategy?: SwarmStrategy;
  readonly config?: Record<string, unknown>;
  readonly force?: boolean;
  readonly reason?: string;
}

const STORE_ID = 'swarm_init' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of swarm-tools.ts
// `swarm_init` handler (validate topology against VALID_TOPOLOGIES, clamp
// maxAgents, emit force-without-reason advisory warning, run ADR-0098 dedupe
// scan over `store.swarms` filtering by {topology, maxAgents, strategy} +
// 7-day TTL, mint a fresh `SwarmState` when no reuse candidate or `force`,
// persist via `saveSwarmStore`). The cli's `withSwarmStoreLock` collapses to
// a single `ctx.substrate.withWrite` here because the substrate primitive
// owns the lock semantics.
export const initSwarmHandler: GuardedWrite<SwarmInitPayload> =
  registerMutationHandler<SwarmInitPayload>(
    'swarm_init',
    async (ctx: MutationContext<false>, _payload: SwarmInitPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: swarm_init handler body pending Phase 5 wire-up; ' +
          'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/swarm-tools.ts swarm_init handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
