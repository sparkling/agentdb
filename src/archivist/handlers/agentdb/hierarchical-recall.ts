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
// ADR-0181 Phase 4 wire-up: the handler reads through `ctx.substrate.vectorSearch`
// against the RVF `agentdb_hierarchical_store` — the same store the
// `agentdb_hierarchical_store` mutation persists tier records into. The substrate
// returns HNSW-ranked hits over ALL tiers in one pass; the optional `tier`
// payload filter is applied client-side over the returned metadata. This is
// correct because RVF has no tier-partitioned index — a tier-scoped pre-filter
// would require a separate per-tier vector index (out of scope for Phase 4).
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_hierarchical-recall` handler (line 501) — delegates to the package-level
// `hierarchicalRecall(...)` helper which calls `HierarchicalMemory.recall(...)`.
//
// Type-enforcement: `ctx.substrate` is read-only narrowing (`ReadContext`, no audit,
// no guard). The `EmbeddingScorer` capability is required to vectorize the query —
// its `requireEmbeddingScorer()` accessor fails loud if no factory was wired into
// `ArchivistInitConfig` (`feedback-no-fallbacks`). Cache scope is `'global'`
// because the hierarchical store spans tiers rather than namespacing per-call —
// the tier filter is a payload field, not a cache partition.

import { registerReadHandler, type GuardedRead, type ReadContext, type StoreId } from '../../index.js';
import type { RankedResult, RankedResults } from '../memory/search.js';

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

const STORE_ID = 'agentdb_hierarchical_store' as StoreId;
const DEFAULT_TOP_K = 5;
const VALID_TIERS = new Set<HierarchicalRecallHit['tier']>(['working', 'episodic', 'semantic']);

/**
 * Shape of the metadata each `agentdb_hierarchical_store` write persists per
 * tier-record vector. Mirrors the `HierarchicalMemory.store(value, importance,
 * tier, { metadata: { key } })` shape: `tier` discriminator + `key` + `value`
 * carried verbatim. `vectorSearch` returns the full `SearchResult` as `item`;
 * the handler reads metadata fields off the substrate's returned shape.
 */
interface HierarchicalSearchItem {
  readonly id: string;
  readonly similarity: number;
  readonly metadata?: {
    readonly tier?: unknown;
    readonly key?: unknown;
    readonly value?: unknown;
    readonly content?: unknown;
    readonly [k: string]: unknown;
  };
}

export const hierarchicalRecallHandler: GuardedRead<AgentdbHierarchicalRecallQuery, RankedResults<HierarchicalRecallHit>> =
  registerReadHandler<AgentdbHierarchicalRecallQuery, RankedResults<HierarchicalRecallHit>>(
    'agentdb_hierarchical_recall',
    async (ctx: ReadContext, payload: AgentdbHierarchicalRecallQuery): Promise<RankedResults<HierarchicalRecallHit>> => {
      const embedder = ctx.capabilities.requireEmbeddingScorer();
      const vector = await embedder.embed(payload.query);
      const topK = payload.topK ?? DEFAULT_TOP_K;

      // Over-fetch when tier-filtering so the post-filter still has a chance of
      // returning `topK` hits per the caller's contract. The RVF index is not
      // tier-partitioned, so a per-tier pre-filter is impossible at the
      // substrate layer (rvf-store.ts:138 — `vectorSearch` takes no filter
      // knob); pulling `topK * 4` and trimming after the tier filter is the
      // closest the read path can get to honouring topK under a tier predicate.
      // Without tier filter this collapses to a single `topK` fetch.
      //
      // 4× is a heuristic, NOT a guarantee — short-return under tier filter is
      // possible and matches the cli's `hierarchicalRecall` behavior
      // (agentdb-orchestration.ts:316-319: cli filters the recall results
      // client-side and returns short with no iteration). The principled
      // alternative — paginate-until-topK-survivors-or-MAX_FETCH_K — is
      // deferred to Phase 7 bench: if tier filtering proves common at large
      // topK, swap the constant for a bounded paginate loop. Until then 4×
      // preserves cli parity and a single substrate round-trip.
      const fetchK = payload.tier ? Math.max(topK * 4, topK) : topK;

      const hits = await ctx.substrate.vectorSearch<HierarchicalSearchItem>({
        storeId: STORE_ID,
        vector,
        topK: fetchK,
      });

      // Build the ranked array from scratch (substrate-semantic immutability):
      // every per-hit field is built into a new HierarchicalRecallHit so the
      // substrate's returned objects are not aliased into the response.
      const ranked: RankedResult<HierarchicalRecallHit>[] = [];
      for (const hit of hits) {
        if (ranked.length >= topK) break;
        const tier = resolveTier(hit.item.metadata?.tier);
        if (!tier) continue; // skip hits whose tier metadata is missing/invalid
        if (payload.tier && tier !== payload.tier) continue;
        const key = typeof hit.item.metadata?.key === 'string' ? hit.item.metadata.key : hit.item.id;
        const value = resolveValue(hit.item.metadata);
        const item: HierarchicalRecallHit = {
          key,
          value,
          tier,
          score: hit.score,
        };
        ranked.push({
          item,
          score: hit.score,
          provenance: {
            storeId: `hierarchical:${tier}`,
            matchType: 'semantic',
            rawScore: hit.score,
            rank: ranked.length + 1,
            matchedField: 'query',
          },
        });
      }
      return ranked;
    },
    { cacheScope: 'global' },
  );

function resolveTier(raw: unknown): HierarchicalRecallHit['tier'] | undefined {
  if (typeof raw !== 'string') return undefined;
  return VALID_TIERS.has(raw as HierarchicalRecallHit['tier'])
    ? (raw as HierarchicalRecallHit['tier'])
    : undefined;
}

/**
 * Hierarchical mutations may persist the record under `metadata.value` (legacy
 * shape) OR `metadata.content` (`HierarchicalMemory.store`'s positional
 * `content` parameter — agentdb-orchestration.ts:283). Read both; prefer
 * `value` because the cli `hierarchicalRecall(...)` flattens the response under
 * that key (agentdb-orchestration.ts:312-313).
 */
function resolveValue(meta: HierarchicalSearchItem['metadata']): unknown {
  if (!meta) return undefined;
  if (meta.value !== undefined) return meta.value;
  if (meta.content !== undefined) return meta.content;
  return undefined;
}
