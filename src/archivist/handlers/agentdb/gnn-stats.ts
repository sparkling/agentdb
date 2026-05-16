// charter: dispatch
// agentdb_gnn_stats read handler (ADR-0181 Item 2 — 2026-05-15).
//
// Splits the `'stats'` action of the legacy `agentdb_neural_patterns` cli tool
// into its own dispatched handler. This eliminates the per-action bypass that
// option (c) of the Item 2 plan would have introduced (cli wrapper short-
// circuiting `'stats'` directly through `getController('gnnService')`).
// b5-queen verdict 2026-05-15 picked option (a): every action goes through
// dispatch; the `'similar'` action stays on the substrate-backed
// `agentdb_neural_patterns` handler, the `'stats'` action lands here against
// the new `GNNTelemetryReader` capability surface.
//
// GNNService is compute-only (`controller-registry.ts:1707-1717`) — no SQLite
// table, no RVF segment. Telemetry (engineType, initialised, cachedPatterns)
// lives on the controller instance. The capability adapter at
// `forks/ruflo/v3/@claude-flow/cli/src/memory/archivist-init.ts`
// (`makeCliGnnTelemetryReader`) resolves the controller PER CALL via
// `getController('gnnService')` so a controller swap mid-process is observed
// at the next dispatch — matches the resolution discipline established by the
// Phase 7 r1 → r2 lesson (cached handles split cli-vs-archivist state).
//
// Type-enforcement: `ctx.substrate` is unused — telemetry is not a substrate
// read. The handler reaches `ctx.capabilities.requireGnnTelemetryReader()` and
// returns the legacy cli response shape so the cli wrapper at
// `agentdb-tools.ts:1992` can surface it verbatim.

import { registerReadHandler } from '../../registration.js';
import type { GuardedRead, ReadContext } from '../../index.js';

/**
 * Input payload — mirrors the cli `agentdb_neural_patterns` `'stats'`-action
 * input fields (`pattern` / `type` are optional informational markers, echoed
 * back so the cli boundary can correlate the response).
 */
export interface AgentdbGnnStatsQuery {
  readonly pattern?: string;
  readonly type?: string;
}

/**
 * Response shape — matches the C/PASS branch of the b5
 * `adr0090-b5-gnnService` probe at
 * `lib/acceptance-adr0090-b5-checks.sh:1540-1554`:
 *
 *     `{success:true, controller:"gnnService", engine:"...", count:N}`
 *
 * `engine` is one of `native | js | unknown` (the b5 regex matches all three);
 * `count` is the cached-patterns count (compute-only — defaults to 0).
 * `initialized` and `marker` / `type` are informational extras the legacy cli
 * shape included; carried through so the cli wrapper can return the same
 * envelope shape it returned pre-Phase-5.
 */
export interface AgentdbGnnStatsResult {
  readonly success: true;
  readonly controller: 'gnnService';
  readonly engine: string;
  readonly initialized: boolean;
  readonly count: number;
  readonly config?: unknown;
  readonly marker: string | null;
  readonly type: string;
}

export const gnnStatsHandler: GuardedRead<AgentdbGnnStatsQuery, AgentdbGnnStatsResult> =
  registerReadHandler<AgentdbGnnStatsQuery, AgentdbGnnStatsResult>(
    'agentdb_gnn_stats',
    async (ctx: ReadContext, payload: AgentdbGnnStatsQuery): Promise<AgentdbGnnStatsResult> => {
      const reader = ctx.capabilities.requireGnnTelemetryReader();
      const stats = await reader.getStats();
      return {
        success: true,
        controller: 'gnnService',
        engine: stats.engine,
        initialized: stats.initialized,
        count: stats.count,
        config: stats.config,
        marker: payload.pattern ?? null,
        type: payload.type ?? 'neural',
      };
    },
    { cacheScope: 'global' },
  );
