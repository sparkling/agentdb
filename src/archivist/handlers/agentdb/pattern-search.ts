// charter: dispatch
// agentdb_pattern_search read handler (ADR-0180 Phase 6, §Architecture · Read-path
// return shape + §Provenance rollout scope).
//
// ReasoningBank search site — a BM25 + semantic fusion path that ADR-0179 names
// alongside `agentdb_filtered_search` as a canonical provenance-mandatory ranked
// read. Per ADR-0180 §Provenance rollout scope, `includeProvenance` is wired
// through here so ExplainableRecall can attribute each pattern hit back to
// (storeId, matchType, rawScore, rank) without a second query. Legacy callers
// continue to receive the flattened `{ results: { id, content, score }[],
// controller }` shape (back-compat); provenance-aware callers pass
// `includeProvenance: true` at the cli boundary and receive `RankedResults<T>`
// verbatim.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_pattern_search` handler (line 280) — delegates to the package-level
// `searchPatterns(...)` helper which routes through `memory-router.ts`
// `routePatternOp` (BM25 + semantic, ReasoningBank-backed).
//
// Substrate routing: this is the one ranked-read whose substrate family is the
// SQLite carve-out (ADR-0166 — `reasoning_patterns` is SQL-addressed, while the
// per-pattern *write* `agentdb_pattern_store` is RVF; this asymmetry is the
// ADR-0166 axis separation, see substrate-registry.ts:94-103). The fusion
// (BM25 + dense + RRF(k=60) + `minConfidence` post-filter) lives behind the
// narrow `PatternReader` capability surface (capabilities.ts:108) rather than
// being reconstructed here from raw `ctx.substrate.query` SQL: rewriting RRF in
// SQL would duplicate the cli `searchPatterns(...)` logic with no carve-out
// gain — the capability factory wires the same ReasoningBank read-path over
// the `sqliteDb` `ArchivistInitConfig` threads. `ctx.substrate` for this
// storeId still classifies to the SQLite carve-out family (so the registry
// resolves the carve-out handle, not RVF), but the dispatch payload reaches
// the patternReader.
//
// Type-enforcement: `ctx.substrate` is read-only narrowing (`ReadContext`, no
// audit, no guard). Per ADR-0180 §Read-path cache writes, this handler MAY
// populate in-memory caches (ReasoningBank embedding cache, QueryOptimizer)
// without invoking MutationGuard — those writes die with the process and are
// reflected in `ctx.cacheHints.wrote_cache` as advisory observability.

import { registerReadHandler, type GuardedRead, type ReadContext } from '../../index.js';
import type { RankedResult, RankedResults } from '../memory/search.js';

/**
 * Input payload mirroring the CLI tool's `agentdb_pattern_search` input shape
 * (agentdb-tools.ts:283-291). `query` / `topK` / `minConfidence` are the
 * ReasoningBank-side names; the cli handler validates and normalizes before
 * delegating, and this archivist handler accepts the same surface so the
 * dispatch boundary can be wired without a second schema translation.
 */
export interface AgentdbPatternSearchQuery {
  readonly query: string;
  readonly topK?: number;
  readonly minConfidence?: number;
}

/**
 * Pattern-search hit shape. Mirrors the `searchPatterns(...)` helper return
 * shape (`{ id, content, score }` per hit). The flat shape pick for
 * `includeProvenance: false` is a field-pick at the dispatch boundary; the
 * `controller` envelope field the cli returned is reconstructed at that
 * boundary from the resolved capability identity.
 */
export interface PatternSearchHit {
  readonly id: string;
  readonly content: string;
  readonly score: number;
}

export const patternSearchHandler: GuardedRead<AgentdbPatternSearchQuery, RankedResults<PatternSearchHit>> =
  registerReadHandler<AgentdbPatternSearchQuery, RankedResults<PatternSearchHit>>(
    'agentdb_pattern_search',
    async (ctx: ReadContext, payload: AgentdbPatternSearchQuery): Promise<RankedResults<PatternSearchHit>> => {
      const reader = ctx.capabilities.requirePatternReader();

      const hits = await reader.searchPatterns({
        query: payload.query,
        topK: payload.topK,
        minConfidence: payload.minConfidence,
      });

      return hits.map((hit, index): RankedResult<PatternSearchHit> => ({
        item: {
          id: hit.id,
          content: hit.content,
          score: hit.score,
        },
        score: hit.score,
        provenance: {
          storeId: 'reasoning_patterns',
          // Fusion site per ADR-0179 — the capability surface composes BM25 +
          // semantic + RRF, so the canonical matchType is `'fused'`. Matches
          // the cli `searchPatterns(...)` composition in `routePatternOp`.
          matchType: 'fused',
          rawScore: hit.score,
          rank: index + 1,
        },
      }));
    },
    { cacheScope: 'namespace' },
  );
