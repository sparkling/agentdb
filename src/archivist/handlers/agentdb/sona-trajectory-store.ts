// charter: dispatch
// agentdb_sona_trajectory_store mutation handler (ADR-0180 Phase 6
// §Architecture · Audit chain). Registers as
// `GuardedWrite<AgentdbSonaTrajectoryStorePayload>` so every
// SonaTrajectoryService write transitions through the archivist's
// audit-chain (intent → applied | rejected) with guard verdicts + invariant
// verdicts recorded.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_sona_trajectory_store` handler (line 2039) — supports two actions:
// `'record'` (default — calls `recordTrajectory`, mutates state) and
// `'stats'` (returns engine + trajectoryCount, READ — not routed here).
// Validates `pattern` (non-empty, max 10KB, required for record),
// `agentType` (default `'mcp-sona-store'`, max 200 chars), trajectory `type`
// (default `'sona-trajectory'`, informational), `reward` via `validateScore`
// (default 0.8), with `confidence` as an alias for `reward` for call-site
// compatibility with the pattern-store contract. The controller is
// pure-compute (in-memory RL store, no SQLite persistence by design — see
// cli line 2031-2037 "Never silently falls back"). The cli callsite stays
// authoritative during the migration window — this file establishes the
// registration shape the dispatch path will resolve.
//
// Action discriminator: `action === 'stats'` is a READ (no mutation); the
// 'record' action is the mutation captured here. During wire-up the
// dispatch boundary inspects the payload's `action` field and routes
// `'stats'` to a sibling `registerReadHandler('agentdb_sona_trajectory_store',
// ...)` registration (split-by-action pattern). The current single
// registration here owns the mutation path; a sibling read registration may
// land alongside.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

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

// TODO(ADR-0180 Phase 6 wire-up): port the body of agentdb-tools.ts
// `agentdb_sona_trajectory_store` handler (record branch only) — (a) resolve
// the SonaTrajectoryService controller via ctx.substrate; (b) validate
// pattern (required for record); (c) call `recordTrajectory({ pattern,
// agentType, type, reward })` normalising the `confidence` alias to `reward`
// per cli line 2067-2069; (d) surface controller-unavailable / method-not-
// callable / action-unsupported as explicit rejections — never silent
// fallback (cli line 2031-2037 / ADR-0082 no-silent-failure). The 'stats'
// branch routes through a sibling `registerReadHandler` registration that
// lands alongside; this mutation handler owns only the record path. The cli
// branch stays in place until the dispatch boundary is wired through.
export const storeSonaTrajectoryHandler: GuardedWrite<AgentdbSonaTrajectoryStorePayload> =
  registerMutationHandler<AgentdbSonaTrajectoryStorePayload>(
    'agentdb_sona_trajectory_store',
    async (ctx: MutationContext<false>, _payload: AgentdbSonaTrajectoryStorePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: agentdb_sona_trajectory_store handler body pending Phase 6 wire-up; ' +
          'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts agentdb_sona_trajectory_store handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );
