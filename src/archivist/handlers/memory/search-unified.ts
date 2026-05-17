// charter: dispatch
// memory_search_unified read handler (ADR-0180 Phase 3, §Architecture · Read-path return shape).
// Cross-store assembly across Claude-Code memories + AgentDB namespaces. Provenance
// per RankedResult records the contributing storeId and per-store pre-dedup rank
// so ExplainableRecall can be reconstructed without a second query.
//
// ADR-0181 Phase 3 Amendment (2026-05-15) + DA ruling (round 2, item 4): cli does
// sort-by-raw-score + dedup, NOT RRF (memory-tools.ts:1112-1118). For strict
// port-fidelity AND consistency with `handlers/agentdb/filtered-search.ts:148-150`
// ("matchType is 'semantic' on the precomputed score, not 'fused'"), this handler
// mirrors the cli's sort+dedup path and emits `matchType: 'semantic'`. ADR-0180
// §Read-path describes RRF(k=60) as the eventual cross-store path, but until the
// upstream cli is genuinely running RRF in production, producing `'fused'` here
// would misrepresent the provenance and break any downstream script the moment
// the cli boundary flips. Phase 4 or later upgrades to `'fused'` once RRF is
// actually the cross-store path.
//
// `rank` per-store 0-based pre-dedup (cli line 1104 — `.forEach((entry, idx)`)
// preserves the signal Phase 4 needs for ExplainableRecall RRF reconstruction.
// Global post-dedup rank can be re-derived from result array order; per-store
// pre-dedup rank cannot.
//
// ADR-0181 task #99 commit 2 (2026-05-17): STORE_ID flipped from
// `memory_search_index` (FS-JSON, never populated in production) to
// `memory_store` (the canonical RVF content store). The handler now drives a
// single substrate `vectorSearch` against `memory_store` (the cli's RVF
// backend is multi-namespace already — HNSW similarity returns top-K across
// every namespace in the store). Per-namespace bucketing + per-store rank
// stamp happens post-search: results are grouped by `metadata.namespace`,
// each bucket is sorted by raw score, and per-store rank is assigned BEFORE
// the global sort+dedup. This preserves the cli's pre-dedup rank signal
// while collapsing the prior "per-namespace iteration" pattern down to a
// single vector query.

import { registerReadHandler } from '../../registration.js';
import type { GuardedRead, ReadContext, StoreId } from '../../index.js';
import type { MemoryRecord, RankedResult, RankedResults } from './search.js';

export interface MemorySearchUnifiedQuery {
  readonly query: string;
  readonly limit?: number;
  readonly namespace?: string;
  readonly threshold?: number;
}

const STORE_ID = 'memory_store' as StoreId;

/**
 * Multiplier on `limit` for the substrate vector query. The cli's unified
 * search runs one vector query per contributing namespace and then merges;
 * here we run a single multi-namespace `vectorSearch` and bucket results
 * post-hoc. To keep enough headroom for namespace-wise pre-dedup rank
 * (especially when many namespaces are below `threshold`), we widen the
 * substrate request by a small constant.
 */
const UNIFIED_TOPK_MULTIPLIER = 8;

/**
 * Substrate `vectorSearch` hit shape — see `./search.ts` for the rationale.
 * The metadata map carries the `MemoryEntryShape` fields the `memory_store`
 * write handler persists (`namespace`, `key`, `content`, ...).
 */
interface VectorSearchHit {
  readonly id: string;
  readonly distance?: number;
  readonly similarity?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Internal candidate shape — substrate hit lifted to `MemoryRecord` fields. */
interface UnifiedCandidate {
  readonly id: string;
  readonly namespace: string;
  readonly key: string;
  readonly content: string;
  readonly score: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly source: string;
}

export const searchUnifiedMemoryHandler: GuardedRead<MemorySearchUnifiedQuery, RankedResults<MemoryRecord>> =
  registerReadHandler<MemorySearchUnifiedQuery, RankedResults<MemoryRecord>>(
    'memory_search_unified',
    async (ctx: ReadContext, payload: MemorySearchUnifiedQuery): Promise<RankedResults<MemoryRecord>> => {
      const ns = payload.namespace && payload.namespace !== 'all' ? payload.namespace : undefined;
      const threshold = payload.threshold ?? 0;
      const limit = payload.limit ?? 10;

      // Empty query is a miss (parity with search.ts; the cli's unified
      // search-tool path bails the same way when the query is falsy).
      if (!payload.query) return [];

      const scorer = ctx.capabilities.requireEmbeddingScorer();
      const queryVector = await scorer.embed(payload.query);

      // Single substrate vector query — the cli's per-namespace fan-out
      // collapses to one HNSW query across the full memory_store. Post-bucket
      // by `metadata.namespace` so per-store rank stamps remain meaningful.
      const topK = limit * UNIFIED_TOPK_MULTIPLIER;
      const hits = await ctx.substrate.vectorSearch<VectorSearchHit>({
        storeId: STORE_ID,
        vector: queryVector,
        topK,
      });

      // Lift hits into candidate records, applying threshold + optional
      // namespace filter early so the buckets only carry survivors.
      const candidates: UnifiedCandidate[] = [];
      for (const hit of hits) {
        const meta = hit.item.metadata ?? {};
        const recordNamespace = typeof meta.namespace === 'string' ? meta.namespace : '';
        if (ns !== undefined && recordNamespace !== ns) continue;
        const score = hit.score;
        if (score < threshold) continue;
        const recordKey = typeof meta.key === 'string' ? meta.key : '';
        const recordContent = typeof meta.content === 'string' ? meta.content : '';
        candidates.push({
          id: hit.item.id,
          namespace: recordNamespace,
          key: recordKey,
          content: recordContent,
          score,
          metadata: { ...meta },
          source: recordNamespace,
        });
      }

      // Capture per-store pre-dedup rank BEFORE the global sort+dedup. Cli
      // does this in `.forEach((entry, idx)` at memory-tools.ts:1092 — `idx`
      // is the per-namespace 0-based position. Group candidates by source
      // store first, then assign per-store rank in raw-score order.
      const byStore = new Map<string, UnifiedCandidate[]>();
      for (const cand of candidates) {
        const bucket = byStore.get(cand.source);
        if (bucket) bucket.push(cand);
        else byStore.set(cand.source, [cand]);
      }
      const perStoreRank = new Map<UnifiedCandidate, { source: string; rank: number }>();
      for (const [source, bucket] of byStore) {
        bucket.sort((a, b) => b.score - a.score);
        bucket.forEach((cand, idx) => {
          perStoreRank.set(cand, { source, rank: idx });
        });
      }

      // Cli's cross-store assembly (memory-tools.ts:1112-1118): sort all
      // candidates by raw score desc, dedupe by key (first occurrence wins),
      // take top-N.
      const allCandidates = candidates.slice();
      allCandidates.sort((a, b) => b.score - a.score);

      const seen = new Set<string>();
      const deduped: UnifiedCandidate[] = [];
      for (const c of allCandidates) {
        if (seen.has(c.key)) continue;
        seen.add(c.key);
        deduped.push(c);
        if (deduped.length >= limit) break;
      }

      return deduped.map((cand): RankedResult<MemoryRecord> => {
        const perStore = perStoreRank.get(cand);
        if (!perStore) {
          throw new Error(
            'archivist: memory_search_unified — candidate missing pre-dedup rank entry (invariant violation)',
          );
        }
        return {
          item: {
            id: cand.id,
            namespace: cand.namespace,
            key: cand.key,
            content: cand.content,
            score: cand.score,
            metadata: cand.metadata,
          },
          score: cand.score,
          provenance: {
            storeId: perStore.source,
            matchType: 'semantic',
            rawScore: cand.score,
            rank: perStore.rank,
            matchedField: 'content',
          },
        };
      });
    },
    { cacheScope: 'global' },
  );
