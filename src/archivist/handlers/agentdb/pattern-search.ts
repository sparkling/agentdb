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
// `routePatternOp` (BM25 + semantic, ReasoningBank-backed). Per Phase 5
// deferral F4-3, the cli callsite stays authoritative during the migration
// window — this file establishes the registration shape the dispatch path
// will resolve when the boundary is wired.
//
// Type-enforcement: `ctx.substrate` is read-only narrowing (`ReadContext`, no
// audit, no guard). Per ADR-0180 §Read-path cache writes, this handler MAY
// populate in-memory caches (ReasoningBank embedding cache, QueryOptimizer)
// without invoking MutationGuard — those writes die with the process and are
// reflected in `ctx.cacheHints.wrote_cache` as advisory observability.

import { registerReadHandler, type GuardedRead, type ReadContext } from '../../index.js';
import type { RankedResults } from '../memory/search.js';

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
 * shape (`{ id, content, score }` per hit, plus `controller` at the envelope
 * level — preserved here as `storeId` in provenance). The flat shape pick for
 * `includeProvenance: false` is a field-pick at the dispatch boundary.
 */
export interface PatternSearchHit {
  readonly id: string;
  readonly content: string;
  readonly score: number;
}

// F4-2 wire-up (Phase B substrate seam live): `agentdb_pattern_search` is the
// one ranked-read tool whose substrate family is the SQLite carve-out (ADR-0166
// — the ReasoningBank GROUP-BY read routes here, while the per-pattern write
// `agentdb_pattern_store` is RVF; this asymmetry is the ADR-0166 axis
// separation, see substrate-registry.ts:94-98).
//
// The carve-out read path is not reachable through the read-only substrate seam
// yet: `ctx.substrate.read` resolves to `makeSqliteSubstrate`'s key/value
// `read`, which deliberately throws ("handlers must query via handle.db") —
// SQLite is SQL-addressed, not whole-document. The SQL surface (`handle.db`)
// is delivered only inside `withWrite`, which the read-only `ReadContext` does
// not expose; and the read-only `substrate.query` is F4-2 Phase B (also throws).
// `ArchivistInitConfig` threads `sqliteDb` for the *mutation* router but no
// read-side SQL handle and no ReasoningBank controller registry.
//
// So the BM25 + semantic legs + RRF(k=60) fusion + `minConfidence` post-filter
// the cli's `searchPatterns(...)` performs cannot run here — every input it
// needs is behind the unfinished config seam. The body THROWS rather than
// returning an empty `RankedResults`: an empty result set silently degrades —
// a caller cannot distinguish "no patterns match" from "this handler is not
// wired" (`feedback-no-fallbacks`). The throw makes a premature dispatch fail
// loud, consistent with the `agentdb_route` peer in this slice.
export const patternSearchHandler: GuardedRead<AgentdbPatternSearchQuery, RankedResults<PatternSearchHit>> =
  registerReadHandler<AgentdbPatternSearchQuery, RankedResults<PatternSearchHit>>(
    'agentdb_pattern_search',
    async (_ctx: ReadContext, _payload: AgentdbPatternSearchQuery): Promise<RankedResults<PatternSearchHit>> => {
      // TODO(F4-2-config): the ReasoningBank patterns table read needs either a
      // read-side SQLite SQL handle or the ReasoningBank controller instance on
      // the read context — `ArchivistInitConfig` threads neither (only the
      // mutation-side `sqliteDb`). Wire one of those through `initialize(config)`
      // + the read-only substrate seam, then port the BM25/semantic/RRF fusion
      // from cli `searchPatterns(...)`.
      throw new Error(
        'archivist: agentdb_pattern_search handler body pending F4-3 config wire-up — ' +
        'SQLite carve-out read needs a read-side SQL handle or the ReasoningBank controller; ' +
        'ArchivistInitConfig threads neither',
      );
    },
    { cacheScope: 'namespace' },
  );
