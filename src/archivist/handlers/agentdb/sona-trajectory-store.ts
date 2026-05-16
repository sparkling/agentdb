// charter: dispatch
// agentdb_sona_trajectory_store mutation + sibling read handlers
// (ADR-0181 Item 6 wire-up, 2026-05-16). Both actions of the cli
// `agentdb_sona_trajectory_store` MCP tool now flow through dispatch:
// `'record'` lands on the mutation handler (audit-chain GuardedWrite),
// `'stats'` lands on the sibling registerReadHandler at the bottom of
// this file (returns SonaStats merged from in-memory + SQLite).
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_sona_trajectory_store` handler — validates `pattern` (non-empty,
// max 10KB, required for record), `agentType` (default `'mcp-sona-store'`,
// max 200 chars), trajectory `type` (default `'sona-trajectory'`,
// informational), `reward` via `validateScore` (default 0.8), with
// `confidence` as an alias for `reward` for call-site compatibility with
// the pattern-store contract.
//
// Item 6 controller change: SonaTrajectoryService gained an optional
// `{ getDb: () => Database }` constructor option (services/SonaTrajectoryService.ts).
// When the cli's controller-registry passes `this.agentdb.database` (via
// the lazy resolver), recordTrajectory dual-writes to a `sona_trajectories`
// SQLite table alongside the in-memory Map. getStats / getPatterns merge
// the two. The RL TRAINING STATE (policy_weights / value_weights /
// experience_buffer / RLMetrics) stays in-memory by design — Item 6 wins
// are durability of the trajectory CORPUS only:
//   1. Cross-process `'stats'` reads see prior writes.
//   2. `getPatterns()` from a fresh process sees the durable corpus.
//   3. Audit chain on `record` via the archivist's withWrite envelope.
// Predict() quality is UNCHANGED — frequencyPredict still reads only the
// in-memory Map, and the @ruvector/sona engine path is untouched. Future
// ADR could close this gap by persisting weights to a sona_rl_state table.
//
// CLI ADAPTER TRACE (b5-da BLOCKING revision a, 2026-05-16): the cli writer
// adapter at `archivist-init.ts:646-703` (`makeCliSonaTrajectoryWriter`)
// translates the dispatch payload `{pattern, agentType, type, reward}`
// into the controller signature `recordTrajectory(agentType, [{state:
// {marker:pattern, type}, action:pattern, reward}])`. The agentType is
// preserved verbatim — the SQLite row's `agent_type` column ends up storing
// the dispatch payload's `agentType` field (`b5-sona` for the b5 probe),
// NOT the marker pattern. The b5 probe at L1853-1855 greps the response
// `agentTypes` array for `b5-sona` against the SELECT-back result; this
// trace + the round-trip vitest case in
// `test/archivist/handlers/agentdb/sona-trajectory-store.test.ts` confirms
// the column ends up correct.
//
// Substrate-registry: the storeId moved from `RVF_STORE_IDS` to
// `SQLITE_CARVE_OUT_STORE_IDS` because the persistence model is now SQLite
// (the writer adapter touches the controller's own SQLite handle via
// dual-write). The cli-side wrapper at agentdb-tools.ts must also flip
// from `ensureRvfWired()` to `ensureSqliteWired()` per the same off-by-one
// fix Phase 7 r3 made for hierarchical-recall (handover §B Phase 7 root
// cause; commit `7a5fa0913`).
//
// Two-dispatch trade-off: the cli wrapper performs TWO archivist
// invocations per b5 record probe — one mutation dispatch + one read
// dispatch (to project trajectoryCount/agentTypes for the response
// envelope). Acceptable per b5-da-q3; refactoring to one-dispatch (the
// mutation handler computes post-write stats inside the withWrite envelope
// and returns them through a typed return shape) is a follow-up, not
// blocking.

import {
  registerMutationHandler,
  registerReadHandler,
  type GuardedRead,
  type GuardedWrite,
  type MutationContext,
  type ReadContext,
  type StoreId,
} from '../../index.js';

/**
 * Discriminator for SonaTrajectoryService actions. `'record'` is the
 * mutation path captured here; `'stats'` is a read sibling owned by a
 * separate `registerReadHandler` registration during the wire-up split.
 */
export type SonaTrajectoryAction = 'record' | 'stats';

/**
 * Mutation payload mirroring the CLI tool's `agentdb_sona_trajectory_store`
 * input shape (agentdb-tools.ts:2042-2070). All fields optional at the cli
 * surface; `pattern` is required when `action === 'record'`. `confidence`
 * aliases `reward` for call-site compatibility (cli line 2067-2069); the
 * dispatch boundary normalizes to `reward` during wire-up.
 */
export interface AgentdbSonaTrajectoryStorePayload {
  readonly action?: SonaTrajectoryAction;
  readonly pattern?: string;
  readonly agentType?: string;
  readonly type?: string;
  readonly reward?: number;
  readonly confidence?: number;
}

const STORE_ID = 'agentdb_sona_trajectory_store' as StoreId;

// ADR-0181 Item 6 — port of cli `agentdb-tools.ts` `agentdb_sona_trajectory_store`
// handler (record branch). The cli wrapper now dispatches `'record'` here
// (mutation) and `'stats'` to the sibling read handler below. The body
// honours `feedback-no-fallbacks`: controller-unavailable / writer error
// propagates as a throw, no silent RVF fallback.
export const storeSonaTrajectoryHandler: GuardedWrite<AgentdbSonaTrajectoryStorePayload> =
  registerMutationHandler<AgentdbSonaTrajectoryStorePayload>(
    'agentdb_sona_trajectory_store',
    async (ctx: MutationContext<false>, payload: AgentdbSonaTrajectoryStorePayload): Promise<void> => {
      // 'stats' is a READ — the cli wrapper now routes it to dispatchRead
      // against the sibling read handler below. Reaching the mutation
      // handler with action='stats' indicates a caller bug (mis-routed
      // through dispatch instead of dispatchRead); fail loud rather than
      // silently no-op.
      if (payload.action === 'stats') {
        throw new Error(
          'archivist: agentdb_sona_trajectory_store mutation — \'stats\' action is read-only; ' +
            'caller must use dispatchRead, not dispatch (ADR-0181 Item 6 split).',
        );
      }
      const pattern = payload.pattern;
      if (!pattern) {
        throw new Error('archivist: agentdb_sona_trajectory_store — pattern is required for record action');
      }
      const agentType = payload.agentType ?? 'mcp-sona-store';
      const type = payload.type ?? 'sona-trajectory';
      // confidence is an alias for reward per cli L2067-2069
      const reward = payload.reward ?? payload.confidence ?? 0.8;
      const writer = ctx.capabilities.requireSonaTrajectoryWriter();

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        const result = await writer.recordTrajectory({ pattern, agentType, type, reward });

        if (result && result.success) return;
        if (result && !result.success && result.error) {
          // ADR-0082: never silent fallback (`feedback-no-fallbacks`).
          throw new Error(`archivist: agentdb_sona_trajectory_store — SonaTrajectoryService: ${result.error}`);
        }
        throw new Error(
          'archivist: agentdb_sona_trajectory_store — SonaTrajectoryService controller not available in this process. ' +
          'Silent RVF fallback is forbidden per `feedback-no-fallbacks`.',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );

/**
 * Response shape for the `'stats'` action — matches what the cli wrapper
 * projects into the b5 probe envelope at agentdb-tools.ts. Mirrors the
 * gnn-stats handler shape (controller name + engine + count) so the b5
 * `adr0090-b5-sonaTrajectory` probe extracts `trajectoryCount` /
 * `agentTypes` directly via the existing regexes (L1816, L1853, L1869).
 */
export interface AgentdbSonaTrajectoryStatsResult {
  readonly success: true;
  readonly controller: 'sonaTrajectory';
  readonly engine: string;
  readonly available: boolean;
  readonly trajectoryCount: number;
  readonly agentTypes: ReadonlyArray<string>;
}

// ADR-0181 Item 6 sibling read handler. Same storeId
// (`agentdb_sona_trajectory_store`) — the dispatcher's read registry is a
// separate namespace from the mutation registry, so co-registering under the
// same name is the intended split-by-action pattern (matches the
// `agentdb_neural_patterns` ('similar') vs `agentdb_gnn_stats` ('stats')
// split landed in Item 2). Reads off the SonaTrajectoryReader capability,
// which adapts the cli `getController('sonaTrajectory').getStats()` per call.
export const readSonaTrajectoryStatsHandler:
  GuardedRead<AgentdbSonaTrajectoryStorePayload, AgentdbSonaTrajectoryStatsResult> =
  registerReadHandler<AgentdbSonaTrajectoryStorePayload, AgentdbSonaTrajectoryStatsResult>(
    'agentdb_sona_trajectory_store',
    async (
      ctx: ReadContext,
      payload: AgentdbSonaTrajectoryStorePayload,
    ): Promise<AgentdbSonaTrajectoryStatsResult> => {
      // The read side accepts only `'stats'`. `'record'` reaching here is a
      // caller bug (mis-routed through dispatchRead instead of dispatch) —
      // fail loud (`feedback-no-fallbacks`).
      if (payload.action && payload.action !== 'stats') {
        throw new Error(
          `archivist: agentdb_sona_trajectory_store read — only 'stats' action is read-side, got '${String(payload.action)}'`,
        );
      }
      const reader = ctx.capabilities.requireSonaTrajectoryReader();
      const stats = await reader.getStats();
      return {
        success: true,
        controller: 'sonaTrajectory',
        engine: stats.engine,
        available: stats.available,
        trajectoryCount: stats.trajectoryCount,
        agentTypes: stats.agentTypes,
      };
    },
    { cacheScope: 'global' },
  );
