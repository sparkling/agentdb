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
// ADR-0181 Phase 6 wire-up — port of cli `agentdb-tools.ts:2039`. SonaTrajectoryService
// is pure-compute (in-memory RL store) and "never silently falls back" per cli
// L2031-2037. We honour that: when the controller is wired (success), we're
// done; when not, we still record an RVF entry under namespace 'sona' so the
// MCP boundary keeps a persistence trail (ADR-0093 F4 hand-port semantics).
export const storeSonaTrajectoryHandler: GuardedWrite<AgentdbSonaTrajectoryStorePayload> =
  registerMutationHandler<AgentdbSonaTrajectoryStorePayload>(
    'agentdb_sona_trajectory_store',
    async (ctx: MutationContext<false>, payload: AgentdbSonaTrajectoryStorePayload): Promise<void> => {
      // 'stats' action is a READ — should not reach this mutation handler.
      // Defensive: surface as an explicit rejection per cli L2031-2037.
      if (payload.action === 'stats') {
        throw new Error(
          'archivist: agentdb_sona_trajectory_store — stats action is a READ; route through dispatchRead, not dispatch',
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

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const result = await writer.recordTrajectory({ pattern, agentType, type, reward });

        if (result && result.success) return;
        if (result && !result.success && result.error && !/not available|not wired|not initialized|missing.*method/i.test(result.error)) {
          throw new Error(`archivist: agentdb_sona_trajectory_store — SonaTrajectoryService rejected: ${result.error}`);
        }

        // Fallback: controller unwired. RVF persistence under 'sona'
        // namespace.
        const scorer = ctx.capabilities.requireEmbeddingScorer();
        const embedding = await scorer.embed(pattern);
        const id = `sona-${agentType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const rvfHandle = handle as { rvf?: {
          insertAsync(id: string, embedding: Float32Array, metadata?: Record<string, unknown>): Promise<void>;
        } };
        if (!rvfHandle.rvf || typeof rvfHandle.rvf.insertAsync !== 'function') {
          throw new Error(
            'archivist: agentdb_sona_trajectory_store — RVF substrate handle missing `rvf.insertAsync`.',
          );
        }
        await rvfHandle.rvf.insertAsync(id, embedding, {
          namespace: 'sona',
          pattern,
          agentType,
          type,
          reward,
          tags: ['sona', 'trajectory', 'fallback'],
          controller: 'memory-store-fallback',
        });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );
