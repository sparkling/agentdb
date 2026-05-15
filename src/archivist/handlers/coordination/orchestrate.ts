// charter: dispatch
// coordination_orchestrate mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<CoordinationOrchestratePayload>` so every
// orchestration record append flows through the archivist's audit-chain
// (intent → applied | rejected) with guard verdicts + invariant verdicts
// recorded.
//
// Per ADR-093 F7 the cli `coordination_orchestrate` only RECORDS a schedule
// request — it does not execute. The mutation is appending an orchestration
// entry to `store.orchestrations[]` (kept as the trailing 100). Honest stub:
// real multi-agent execution lives in agent_spawn + Task tool, or
// hive-mind_spawn for queen-led coordination. The handler's shape here matches
// the cli's persistence behaviour, NOT a future execution surface.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/coordination-tools.ts`
// `coordination_orchestrate` handler — builds an orchestration record, appends
// to `orchStore.orchestrations[]` (created lazily), trims to 100, then
// `saveCoordStore`. The cli callsite stays in place until the dispatch
// boundary is wired through cli; this file establishes the registration shape.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/coordination/store.json` may mutate. The underlying primitive
// is `makeFsJsonSubstrate` (substrates/fs-json-store.ts), shared with the
// other five `coordination_*` mutation handlers.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/** Orchestration strategy — matches the CLI inputSchema enum. */
export type OrchestrationStrategy = 'parallel' | 'sequential' | 'pipeline' | 'broadcast';

/**
 * Mutation payload mirroring the CLI tool's `coordination_orchestrate` input
 * shape (coordination-tools.ts inputSchema lines 742-748). `task` is REQUIRED
 * (matches the cli's `required: ['task']`); `agents` defaults to
 * `Object.keys(store.nodes)` and `strategy` defaults to `'parallel'` at the
 * wire-up callsite.
 */
export interface CoordinationOrchestratePayload {
  readonly task: string;
  readonly agents?: ReadonlyArray<string>;
  readonly strategy?: OrchestrationStrategy;
  readonly timeout?: number;
}

const STORE_ID = 'coordination_orchestrate' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of coordination-tools.ts
// `coordination_orchestrate` callsite once the dispatch boundary is wired
// through cli. The wrapper-in-cli pattern (loadCoordStore → mint
// orchestrationId → append + trim to 100 → saveCoordStore via direct
// writeFileSync) collapses to a single `ctx.substrate.withWrite` here because
// `makeFsJsonSubstrate` owns the lock semantics.
//
// Invariants-author note: the cli currently casts `store as CoordStoreShape`
// to lazily extend with an `orchestrations` array — that's a CLI-shape hack.
// During wire-up, fold `orchestrations` into the canonical store schema so
// the cast disappears. The 100-entry ring-buffer cap is a substrate-level
// retention concern, not a mutation invariant.
export const orchestrateCoordinationHandler: GuardedWrite<CoordinationOrchestratePayload> =
  registerMutationHandler<CoordinationOrchestratePayload>(
    'coordination_orchestrate',
    async (ctx: MutationContext<false>, _payload: CoordinationOrchestratePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: coordination_orchestrate handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/coordination-tools.ts ' +
          '\'coordination_orchestrate\' handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
