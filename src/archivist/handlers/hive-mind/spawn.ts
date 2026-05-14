// charter: dispatch
// hive-mind_spawn mutation handler (ADR-0180 Phase 4, §Architecture · Audit chain).
// Registers as `GuardedWrite<HiveMindSpawnPayload>` so every spawn transitions
// through the archivist's audit-chain (intent → applied | rejected) with
// guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/hive-mind-tools.ts`
// `hive-mind_spawn` handler — combines agent/spawn + hive-mind/join, mutating
// BOTH `.claude-flow/agents.json` (agent records) AND `.claude-flow/hive-mind/state.json`
// (`state.workers` + `state.workerMeta[id].retryOf` via `registerWorkerRetry`)
// inside a single `withHiveStoreLock` per ADR-0129 (B1) race-fix. The cli
// callsite stays in place until the dispatch boundary is wired through cli
// (mirroring broadcast/consensus/memory pending wire-up). This file establishes
// the registration shape the dispatch path will resolve.
//
// ADR-0131 (T12) — `retryTask` is the canonical retry-once action variant.
// `retryOf` records the predecessor worker ID on the new entry's
// `workerMeta.retryOf` (single pointer per §Decision Outcome, not a chain).
//
// ADR-0108 (T13) — `agentType` (scalar) and `agentTypes` (array) are mutually
// exclusive; when `agentTypes` is provided the per-worker distribution is
// round-robin `agentTypes[i % agentTypes.length]`. Both surfaces fail loud
// via `validateWorkerType` per `feedback-no-fallbacks`.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// hive-mind spawn state may mutate. Two FS-JSON consumers (agents.json,
// hive-state.json) compose under one substrate withWrite — the substrate's
// O_EXCL sentinel lock subsumes the legacy `withHiveStoreLock` (ADR-0129 B1)
// because the migrated wire-up routes both stores through the same primitive.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/** Spawn action discriminator — matches the CLI inputSchema enum (ADR-0131 T12). */
export type HiveMindSpawnAction = 'spawn' | 'retryTask';

/** Worker role within the hive — matches the CLI inputSchema enum. */
export type HiveMindSpawnRole = 'worker' | 'specialist' | 'scout';

/**
 * Mutation payload mirroring the CLI tool's `hive-mind_spawn` input shape.
 * Defaults applied at the wire-up callsite: `action='spawn'`, `count=1`,
 * `role='worker'`, `prefix='hive-worker'`, `agentType='worker'` (when
 * `agentTypes` not provided).
 */
export interface HiveMindSpawnPayload {
  readonly action?: HiveMindSpawnAction;
  readonly count?: number;
  readonly role?: HiveMindSpawnRole;
  readonly agentType?: string;
  readonly agentTypes?: ReadonlyArray<string>;
  readonly prefix?: string;
  readonly retryOf?: string;
}

const STORE_ID = 'hive-mind_spawn' as StoreId;

// TODO(ADR-0180 Phase 4 wire-up): port the body of hive-mind-tools.ts
// `hive-mind_spawn` callsite (validate agentType/agentTypes mutex →
// loadHiveState + loadAgentStore → per-worker ID minting (retry-1 suffix
// when action='retryTask') → write agent record → push to state.workers →
// registerWorkerRetry → saveAgentStore + saveHiveState) once the dispatch
// boundary is wired through cli. The cli's outer `withHiveStoreLock`
// collapses to a single `ctx.substrate.withWrite` here because the
// substrate primitive owns the lock semantics; both consumers (agents.json
// + hive-state.json) compose under one withWrite scope.
export const spawnHiveMindHandler: GuardedWrite<HiveMindSpawnPayload> =
  registerMutationHandler<HiveMindSpawnPayload>(
    'hive-mind_spawn',
    async (ctx: MutationContext<false>, _payload: HiveMindSpawnPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: hive-mind_spawn handler body pending Phase 4 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/hive-mind-tools.ts hive-mind_spawn handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
