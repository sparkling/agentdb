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
} from '../../index.js';
import type { AgentRecord } from './agents-json.js';
import type { HiveStateDoc, HiveWorkerMeta } from './hive-state.js';

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

const HIVE_STORE_ID = 'hive-mind_spawn' as StoreId;
const AGENTS_STORE_ID = 'hive-mind_agents' as StoreId;

/** Valid worker types per ADR-0108 — mirrors cli `validate-input.ts`
 *  `WORKER_TYPES`. Used to fail-loud on an unknown `agentTypes` member
 *  rather than silently routing to a generic worker. */
const WORKER_TYPES: ReadonlyArray<string> = [
  'researcher', 'coder', 'analyst', 'tester', 'architect', 'reviewer',
  'optimizer', 'documenter', 'specialist', 'coordinator', 'monitor',
];

/** Agents.json document shape — `agents-json.ts` keyed by `agentId`. */
interface AgentsJsonDoc {
  agents: Record<string, AgentRecord>;
}

// Ported from cli/src/mcp-tools/hive-mind-tools.ts `hive-mind_spawn` handler
// (lines 1389-1541). The cli's `withHiveStoreLock` wrapping `loadHiveState +
// loadAgentStore → mutate → saveAgentStore + saveHiveState` collapses to two
// nested `ctx.substrate.withWrite` scopes — one per store. Each substrate
// owns its own O_EXCL lock keyed by storeId; the two locks point at different
// files (`.claude-flow/hive-mind/state.json` vs `.claude-flow/agents.json`)
// so the nesting order is deadlock-free, matching the `task_complete`
// two-store precedent (handlers/tasks/complete.ts).
//
// ADR-0108 (T13): `agentType` (scalar) and `agentTypes` (array) are mutually
// exclusive; `agentTypes` distributes round-robin per worker. Both fail loud
// on unknown values (`feedback-no-fallbacks`). Validation runs BEFORE the
// write scopes so a bad payload throws without a partial write.
// ADR-0131 (T12): `action='retryTask'` requires `retryOf` and mints the
// canonical `<retryOf>-retry-N` worker ID; `retryOf` records the predecessor
// pointer on the new worker's `workerMeta.retryOf` (single pointer, not a chain).
export const spawnHiveMindHandler: GuardedWrite<HiveMindSpawnPayload> =
  registerMutationHandler<HiveMindSpawnPayload>(
    'hive-mind_spawn',
    async (ctx: MutationContext<false>, payload: HiveMindSpawnPayload): Promise<void> => {
      const action = payload.action ?? 'spawn';
      const rawRetryOf = payload.retryOf || undefined;

      if (action === 'retryTask' && !rawRetryOf) {
        throw new Error(
          'hive-mind_spawn: retryTask requires `retryOf` (the original worker ID being retried)',
        );
      }

      const count = Math.min(Math.max(1, payload.count ?? 1), 20);
      const role = payload.role ?? 'worker';
      const prefix = payload.prefix ?? 'hive-worker';

      // ADR-0108 (T13): scalar/array mutex. An explicit `agentType` (anything
      // other than the 'worker' default) alongside a non-empty `agentTypes`
      // is a caller error — fail loud rather than apply a silent precedence.
      const agentTypeIsExplicit =
        payload.agentType !== undefined &&
        payload.agentType !== '' &&
        payload.agentType !== 'worker';
      const agentTypesArr =
        Array.isArray(payload.agentTypes) && payload.agentTypes.length > 0
          ? payload.agentTypes
          : undefined;

      if (agentTypeIsExplicit && agentTypesArr !== undefined) {
        throw new Error(
          'hive-mind_spawn: agentType and agentTypes are mutually exclusive; ' +
            'use agentTypes for mixed spawns',
        );
      }
      if (Array.isArray(payload.agentTypes) && payload.agentTypes.length === 0) {
        throw new Error('hive-mind_spawn: agentTypes must contain at least one worker type');
      }
      if (agentTypesArr !== undefined) {
        for (const t of agentTypesArr) {
          if (typeof t !== 'string' || !WORKER_TYPES.includes(t)) {
            throw new Error(
              `hive-mind_spawn: agentTypes contains invalid value ${JSON.stringify(t)} ` +
                `(one of: ${WORKER_TYPES.join(', ')})`,
            );
          }
        }
      }

      // Pre-compute the per-worker type list. With `agentTypes` the
      // distribution is round-robin `agentTypes[i % len]`; otherwise the
      // scalar `agentType` (or 'worker' default) is replicated.
      const scalarAgentType = payload.agentType || 'worker';
      const perWorkerTypes: string[] = [];
      for (let i = 0; i < count; i++) {
        perWorkerTypes.push(
          agentTypesArr !== undefined
            ? (agentTypesArr[i % agentTypesArr.length] as string)
            : scalarAgentType,
        );
      }

      // ── Store A: hive state — validate initialization, mint worker IDs,
      // push to state.workers, record retry lineage. The minted IDs are
      // carried out to the agents.json write below.
      const spawnedAgentIds: string[] = [];
      const spawnedAgentTypes: string[] = [];

      await ctx.substrate.withWrite({ storeId: HIVE_STORE_ID }, async (handle) => {
        const state = await handle.read<HiveStateDoc>({ storeId: HIVE_STORE_ID, key: 'root' });
        if (!state) {
          throw new Error('hive-mind_spawn: hive-mind not initialized — run hive-mind_init first');
        }
        if (!state.initialized) {
          throw new Error('hive-mind_spawn: hive-mind not initialized — run hive-mind_init first');
        }

        if (!state.workerMeta) {
          state.workerMeta = {};
        }
        const workerMeta = state.workerMeta;

        for (let i = 0; i < count; i++) {
          // ADR-0131 (T12): retryTask uses the canonical `<original>-retry-N`
          // ID convention; plain spawn mints a timestamped random ID.
          let agentId: string;
          if (action === 'retryTask' && rawRetryOf) {
            const suffix = count === 1 ? 'retry-1' : `retry-${i + 1}`;
            agentId = `${rawRetryOf}-${suffix}`;
          } else {
            agentId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          }
          const thisType = perWorkerTypes[i] as string;

          if (!state.workers.includes(agentId)) {
            state.workers.push(agentId);
          }

          // ADR-0131 (T12): record the single retry-lineage pointer on the new
          // worker's metadata.
          if (rawRetryOf) {
            const meta: HiveWorkerMeta = workerMeta[agentId] ?? {
              failedAt: null,
              retryOf: null,
            };
            meta.retryOf = rawRetryOf;
            workerMeta[agentId] = meta;
          }

          spawnedAgentIds.push(agentId);
          spawnedAgentTypes.push(thisType);
        }

        await handle.write({ storeId: HIVE_STORE_ID, key: 'root', payload: state });
      });

      // ── Store B: agents.json — write one agent record per minted worker.
      // Separate withWrite scope, separate O_EXCL lock (different file) —
      // mirrors the two-store `task_complete` precedent.
      await ctx.substrate.withWrite({ storeId: AGENTS_STORE_ID }, async (handle) => {
        const current = await handle.read<AgentsJsonDoc>({
          storeId: AGENTS_STORE_ID,
          key: 'root',
        });
        const agentStore: AgentsJsonDoc = current ?? { agents: {} };

        for (let i = 0; i < spawnedAgentIds.length; i++) {
          const agentId = spawnedAgentIds[i] as string;
          agentStore.agents[agentId] = {
            agentId,
            agentType: spawnedAgentTypes[i] as string,
            status: 'idle',
            health: 1.0,
            taskCount: 0,
            config: { role, hiveRole: role },
            createdAt: new Date().toISOString(),
            domain: 'hive-mind',
          };
        }

        await handle.write({ storeId: AGENTS_STORE_ID, key: 'root', payload: agentStore });
      });
    },
    {
      invariants: [], // cross-store spawn invariant authored by invariants-author
      cacheScope: 'global',
    },
  );
