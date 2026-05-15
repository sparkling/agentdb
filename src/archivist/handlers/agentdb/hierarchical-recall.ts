// charter: dispatch
// agentdb_hierarchical_recall read handler (ADR-0180 Phase 6, §Architecture · Read-path
// return shape + §Provenance rollout scope).
//
// Recalls entries from the hierarchical memory store (working / episodic / semantic
// tiers — ADR-0140 / HierarchicalMemory controller) by similarity to a query, with
// optional tier filter. Registers as `GuardedRead<AgentdbHierarchicalRecallQuery,
// RankedResults<HierarchicalRecallHit>>` so every candidate carries provenance
// verbatim (storeId='hierarchical:<tier>', matchType='semantic', rawScore, rank).
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_hierarchical-recall` handler (line 501) — delegates to the package-level
// `hierarchicalRecall(...)` helper. Per Phase 6 wire-up policy, the cli callsite
// stays authoritative during the migration window; this file establishes the
// registration shape the dispatch path will resolve. Legacy callers continue to
// receive the flattened `{ results: [...] }` shape; provenance-aware callers pass
// `includeProvenance: true` at the cli boundary and receive `RankedResults<T>`.
//
// Type-enforcement: `ctx.substrate` is read-only narrowing (`ReadContext`, no audit,
// no guard). Cache scope is `'global'` because the hierarchical store spans tiers
// rather than namespacing per-call — the tier filter is a payload field, not a
// cache partition.

import { registerReadHandler, type GuardedRead, type ReadContext } from '../../index.js';
import type { RankedResults } from '../memory/search.js';

export interface AgentdbHierarchicalRecallQuery {
  readonly query: string;
  readonly tier?: 'working' | 'episodic' | 'semantic';
  readonly topK?: number;
}

/**
 * Hierarchical-recall hit shape. Mirrors the underlying `hierarchicalRecall(...)`
 * helper's per-result shape (key + value + tier + score) so a dispatch-side flatten
 * back to legacy `{ results: [{ key, value, tier, score }] }` is a field-pick when
 * `includeProvenance: false`.
 */
export interface HierarchicalRecallHit {
  readonly key: string;
  readonly value: unknown;
  readonly tier: 'working' | 'episodic' | 'semantic';
  readonly score: number;
}

// TODO(ADR-0180 Phase 6 wire-up): port the recall body from
// cli/src/mcp-tools/agentdb-tools.ts agentdb_hierarchical-recall handler:
// (a) resolve the HierarchicalMemory controller via ctx.substrate (read-only narrow);
// (b) run similarity over the requested tier (or all tiers when undefined), capturing
//     rawScore per hit before normalization;
// (c) emit `RankedResult<HierarchicalRecallHit>[]` with provenance per candidate:
//     `{ storeId: 'hierarchical:<tier>', matchType: 'semantic', rawScore, rank }`.
// The cli branch stays in place until the dispatch boundary is wired through;
// this handler is the registration shape the dispatch path will resolve.
export const hierarchicalRecallHandler: GuardedRead<AgentdbHierarchicalRecallQuery, RankedResults<HierarchicalRecallHit>> =
  registerReadHandler<AgentdbHierarchicalRecallQuery, RankedResults<HierarchicalRecallHit>>(
    'agentdb_hierarchical_recall',
    async (_ctx: ReadContext, _payload: AgentdbHierarchicalRecallQuery): Promise<RankedResults<HierarchicalRecallHit>> => {
      throw new Error(
        'archivist: agentdb_hierarchical_recall handler body pending Phase 6 wire-up; ' +
        'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts agentdb_hierarchical-recall handler',
      );
    },
    { cacheScope: 'global' },
  );
