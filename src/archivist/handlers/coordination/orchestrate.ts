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
import {
  COORD_STORE_KEY,
  loadCoordStore,
  type CoordinationStore,
  type CoordOrchestration,
} from './shared.js';

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

// Ports the body of coordination-tools.ts `coordination_orchestrate`. The cli's
// `loadCoordStore → mint orchestrationId → append + trim to 100 → saveCoordStore`
// collapses to one `ctx.substrate.withWrite`. The cli's `store as CoordStoreShape`
// cast is gone — `orchestrations` is now part of the canonical `CoordinationStore`
// shape in shared.ts. The 100-entry ring-buffer cap is kept inline (it ports
// verbatim from the cli; treating it as substrate-level retention is a later
// concern, not a Phase 2 one).
export const orchestrateCoordinationHandler: GuardedWrite<CoordinationOrchestratePayload> =
  registerMutationHandler<CoordinationOrchestratePayload>(
    'coordination_orchestrate',
    async (ctx: MutationContext<false>, payload: CoordinationOrchestratePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<CoordinationStore>({
          storeId: STORE_ID,
          key: COORD_STORE_KEY,
        });
        const store: CoordinationStore = current ?? loadCoordStore();

        const orchestrationId = `orch-${Date.now()}`;
        const agents = payload.agents ?? Object.keys(store.nodes);
        const strategy: OrchestrationStrategy = payload.strategy ?? 'parallel';

        // ADR-093 F7: this records the orchestration request — it does not
        // execute. Real multi-agent execution lives in agent_spawn + the Task
        // tool, or hive-mind_spawn for queen-led coordination.
        const orchestration: CoordOrchestration = {
          id: orchestrationId,
          task: payload.task,
          strategy,
          agents: [...agents],
          status: 'scheduled',
          scheduledAt: new Date().toISOString(),
          topology: store.topology.type,
        };

        if (!Array.isArray(store.orchestrations)) store.orchestrations = [];
        store.orchestrations.push(orchestration);
        if (store.orchestrations.length > 100) {
          store.orchestrations = store.orchestrations.slice(-100);
        }

        await handle.write({ storeId: STORE_ID, key: COORD_STORE_KEY, payload: store });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
