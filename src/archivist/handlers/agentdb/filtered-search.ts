// charter: dispatch
// agentdb_filtered_search read handler (ADR-0180 Phase 6, §Architecture · Read-path
// return shape + §Provenance rollout scope).
//
// This is the BM25 + semantic fusion site called out by ADR-0179 as the canonical
// example of why ranked reads must surface provenance. Per ADR-0180 §Provenance
// rollout scope, `includeProvenance` is MANDATORY here — the fusion path is exactly
// what ExplainableRecall needs to attribute hits back to (storeId, matchType,
// rawScore, rank) without a second query. Legacy callers continue to receive the
// flattened `{ id, content, score }[]` shape (back-compat); provenance-aware callers
// pass `includeProvenance: true` at the cli boundary and receive `RankedResults<T>`
// verbatim.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_filtered_search` handler (line 1337) — delegates to the package-level
// `filteredSearch(...)` helper which runs MongoDB-style metadata filtering (B5
// MetadataFilter, ADR-0043) atop semantic similarity. Per Phase 5 deferral F4-3,
// the cli callsite stays authoritative during the migration window — this file
// establishes the registration shape the dispatch path will resolve when the
// boundary is wired.
//
// Type-enforcement: `ctx.substrate` is read-only narrowing (`ReadContext`, no audit,
// no guard). Per ADR-0180 §Read-path cache writes, this handler MAY populate
// in-memory caches (QueryOptimizer, LRU embedding cache) without invoking
// MutationGuard — those writes die with the process and are reflected in
// `ctx.cacheHints.wrote_cache` as advisory observability.

import { registerReadHandler, type GuardedRead, type ReadContext, type StoreId } from '../../index';
import type { RankedResult, RankedResults } from '../memory/search';

/**
 * Input payload mirroring the CLI tool's `agentdb_filtered_search` input shape
 * (agentdb-tools.ts:1342-1351). The MongoDB-style filter operators ($gt, $lt,
 * $gte, $lte, $eq, $ne, $in, $nin, $regex, $exists, $and, $or, $not, $elemMatch)
 * are validated by the B5 MetadataFilter at the substrate boundary.
 */
export interface AgentdbFilteredSearchQuery {
  readonly query: string;
  readonly filter?: Record<string, unknown>;
  readonly namespace?: string;
  readonly limit?: number;
  readonly threshold?: number;
}

/**
 * Filtered-search hit shape. Mirrors the underlying `filteredSearch(...)`
 * helper's return shape (id + content + score + optional metadata) so a
 * dispatch-side flatten back to legacy `{ id, content, score }[]` is a
 * field-pick when `includeProvenance: false`.
 */
export interface FilteredSearchHit {
  readonly id: string;
  readonly content: string;
  readonly score: number;
  readonly namespace?: string;
  readonly metadata?: Record<string, unknown>;
}

const STORE_ID = 'agentdb_filtered_search' as StoreId;

/**
 * On-disk document the FS-JSON `agentdb_filtered_search` substrate owns. The
 * store is whole-document key/value: `key: 'root'` holds the candidate corpus
 * the filter runs against. Hits carry a precomputed `score` (the semantic
 * similarity captured at write time by the pattern/feedback store path).
 */
interface FilteredSearchStore {
  readonly hits: ReadonlyArray<FilteredSearchHit>;
}

/**
 * Resolve one MongoDB-style operator atom against a candidate's field value.
 * Mirrors the B5 MetadataFilter operator set (ADR-0043) that the cli's
 * `filteredSearch(...)` helper applies at the substrate boundary. Logical
 * combinators ($and/$or/$not) are handled one level up in `matchesFilter`.
 */
function matchesOperator(value: unknown, op: string, operand: unknown): boolean {
  switch (op) {
    case '$eq': return value === operand;
    case '$ne': return value !== operand;
    case '$gt': return typeof value === 'number' && typeof operand === 'number' && value > operand;
    case '$gte': return typeof value === 'number' && typeof operand === 'number' && value >= operand;
    case '$lt': return typeof value === 'number' && typeof operand === 'number' && value < operand;
    case '$lte': return typeof value === 'number' && typeof operand === 'number' && value <= operand;
    case '$in': return Array.isArray(operand) && operand.includes(value);
    case '$nin': return Array.isArray(operand) && !operand.includes(value);
    case '$exists': return (value !== undefined) === Boolean(operand);
    case '$regex':
      return typeof value === 'string' && typeof operand === 'string'
        && new RegExp(operand).test(value);
    case '$elemMatch':
      return Array.isArray(value)
        && value.some((el) => matchesFilter(el as Record<string, unknown>, operand as Record<string, unknown>));
    default:
      // Unknown operator: fail loud rather than silently passing the candidate
      // through (`feedback-no-fallbacks`) — a typo'd operator must not widen
      // the result set.
      throw new Error(`archivist: agentdb_filtered_search — unsupported metadata filter operator '${op}'`);
  }
}

/**
 * Evaluate a MongoDB-style filter expression against a candidate's metadata.
 * Supports the field-level operator atoms plus the $and/$or/$not combinators.
 * An empty / absent filter matches every candidate.
 */
function matchesFilter(meta: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    if (key === '$and') {
      if (!Array.isArray(condition) || !condition.every((c) => matchesFilter(meta, c as Record<string, unknown>))) {
        return false;
      }
      continue;
    }
    if (key === '$or') {
      if (!Array.isArray(condition) || !condition.some((c) => matchesFilter(meta, c as Record<string, unknown>))) {
        return false;
      }
      continue;
    }
    if (key === '$not') {
      if (matchesFilter(meta, condition as Record<string, unknown>)) return false;
      continue;
    }
    const fieldValue = meta[key];
    if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
      // Operator object: every operator atom must hold.
      for (const [op, operand] of Object.entries(condition as Record<string, unknown>)) {
        if (!matchesOperator(fieldValue, op, operand)) return false;
      }
    } else if (fieldValue !== condition) {
      // Bare scalar: implicit $eq.
      return false;
    }
  }
  return true;
}

// F4-2 wire-up (Phase B substrate seam live): this handler reads the persisted
// candidate corpus through `ctx.substrate.read` (the whole-document FS-JSON
// store), applies the B5 MongoDB-style metadata filter (ADR-0043) + similarity
// threshold + limit, ranks by the precomputed semantic `score`, and emits
// `RankedResult<FilteredSearchHit>[]` with provenance per candidate.
//
// The BM25 leg + RRF fusion the cli's `filteredSearch(...)` performs is NOT
// reproducible here yet: BM25 needs the read-only `substrate.query` surface
// (F4-2 Phase B — currently throws) or the FilteredSearch controller instance,
// and `ArchivistInitConfig` threads only `rvfBackend` / `sqliteDb` /
// `projectRoot` — no controller registry. So matchType is `'semantic'` on the
// precomputed score, not `'fused'`. See the per-leg TODO(F4-2-config) below.
export const filteredSearchHandler: GuardedRead<AgentdbFilteredSearchQuery, RankedResults<FilteredSearchHit>> =
  registerReadHandler<AgentdbFilteredSearchQuery, RankedResults<FilteredSearchHit>>(
    'agentdb_filtered_search',
    async (ctx: ReadContext, payload: AgentdbFilteredSearchQuery): Promise<RankedResults<FilteredSearchHit>> => {
      const store = await ctx.substrate.read<FilteredSearchStore>({ storeId: STORE_ID, key: 'root' });
      const corpus = store?.hits ?? [];

      const threshold = payload.threshold ?? 0.3;
      const limit = payload.limit ?? 10;
      const filter = payload.filter;

      // TODO(F4-2-config): the BM25 leg + RRF(k=60) fusion requires either the
      // read-only `substrate.query` surface (F4-2 Phase B) or the FilteredSearch
      // controller — neither is threaded through `ArchivistInitConfig` today.
      // Until then ranking uses the precomputed semantic `score` only.
      const filtered = corpus
        .filter((hit) => (payload.namespace ? hit.namespace === payload.namespace : true))
        .filter((hit) => hit.score >= threshold)
        .filter((hit) => (filter ? matchesFilter(hit.metadata ?? {}, filter) : true))
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return filtered.map((hit, index): RankedResult<FilteredSearchHit> => ({
        item: hit,
        score: hit.score,
        provenance: {
          storeId: STORE_ID as string,
          matchType: 'semantic',
          rawScore: hit.score,
          rank: index + 1,
          matchedField: filter ? 'metadata' : 'content',
        },
      }));
    },
    { cacheScope: 'namespace' },
  );
