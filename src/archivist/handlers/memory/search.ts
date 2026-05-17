// charter: dispatch
// memory_search read handler (ADR-0180 Phase 3, §Architecture · Read-path return shape).
// Registers as `GuardedRead<MemorySearchQuery, RankedResults<MemoryRecord>>` so
// every candidate carries provenance verbatim. cli-side flattening (legacy
// `{id, content, score}[]`) vs full RankedResult shape is gated by the
// includeProvenance parameter wired at the cli boundary (memory-tools.ts).
//
// ADR-0181 task #99 commit 2 (2026-05-17): STORE_ID flipped from
// `memory_search_index` (FS-JSON, never populated in production) to
// `memory_store` (the canonical RVF content store the `memory_store` write
// handler persists into). The handler now drives the substrate's
// `vectorSearch` (HNSW similarity over the wired `MemoryRvfAdapter`) —
// the same path the cli's `routeMemoryOp` case 'search' (memory-router.ts:1205
// — `storage.search(embedding, {k, threshold, filters})`) runs in production.
// Query-side embedding is generated through the read-side EmbeddingScorer
// capability (`ctx.capabilities.requireEmbeddingScorer()` — ADR-0069 unified
// mpnet pipeline), mirroring how `store.ts` mints the storage-side embedding.
//
// Out of scope here (preserved at the cli boundary post-dispatch, NOT pulled
// in by this collapse):
//   - QueryOptimizer / MetadataFilter / MMRDiversityRanker / AttentionService
//     fusion (memory-tools.ts:397-583 — those branch on the cli controllers,
//     not on the substrate seam).
//   - BM25 hash-fallback path (memory-router.ts:1155-1185 — gated on
//     `pipelineProvider === 'hash-fallback'`; the cli still owns the
//     pipeline-mode detection).
//   - Response-envelope wrapping (Phase 3 DA ruling, round 2, item 7): the cli
//     constructs `{ query, results, total, searchTime, backend, attention, ... }`
//     at the boundary POST-dispatchRead, NOT in this handler. This handler
//     returns ONLY `RankedResults<MemoryRecord>` (the array).
//
// Namespace filtering: the substrate `vectorSearch` is namespace-agnostic
// (HNSW similarity over the full store). The cli passes `filters: { namespace }`
// to `storage.search`; here we post-filter the substrate's results by
// `metadata.namespace`. Topk is widened by a small factor so the post-filter
// has headroom — `topK * NS_OVERFETCH` per cli search heuristics.

import { registerReadHandler } from '../../registration.js';
import type { GuardedRead, ReadContext, StoreId } from '../../index.js';

export interface MemorySearchQuery {
  readonly namespace?: string;
  readonly text: string;
  readonly limit?: number;
  readonly threshold?: number;
  readonly filters?: Record<string, unknown>;
}

export interface MemoryRecord {
  readonly id: string;
  readonly namespace: string;
  readonly key: string;
  readonly content: string;
  readonly score: number;
  readonly metadata?: Record<string, unknown>;
  /**
   * ADR-0181 task #100 (cli-flip prep) — fields the cli's pre-flip envelope
   * exposed (memory-tools.ts retrieve/search). Optional so the substrate seam
   * surfaces them when available without forcing every projection to compute
   * them (search hits don't carry `embedding` in the substrate result; only
   * `retrieve.ts` populates `hasEmbedding` today). Adding them here keeps the
   * `MemoryRecord` type stable across retrieve / search / search_unified —
   * widening shared shapes per the trace investigation for task #100.
   */
  readonly tags?: readonly string[];
  readonly accessCount?: number;
  readonly hasEmbedding?: boolean;
}

export interface Provenance {
  readonly storeId: string;
  readonly matchType: 'semantic' | 'bm25' | 'exact' | 'fused' | 'status';
  readonly rawScore: number;
  readonly rank: number;
  readonly matchedField?: string;
  readonly explanation?: string;
}

export interface RankedResult<T> {
  readonly item: T;
  readonly score: number;
  readonly provenance: Provenance;
}

export type RankedResults<T> = ReadonlyArray<RankedResult<T>>;

const STORE_ID = 'memory_store' as StoreId;

/**
 * Overfetch factor for the namespace post-filter. The substrate's
 * `vectorSearch` returns top-K across all namespaces; when the caller scopes
 * to a single namespace we widen the request to `topK * NS_OVERFETCH` so the
 * filter has headroom before slicing back to `limit`. Tuned conservatively —
 * the cli's `storage.search` does push-down namespace filtering and never
 * needs overfetch, but the substrate seam is content-store-agnostic and the
 * RVF backend's HNSW search has no namespace-aware partition today.
 */
const NS_OVERFETCH = 4;

/**
 * Shape the substrate's `vectorSearch` yields for an RVF store
 * (`{ item: SearchResult, score: number }`, where `SearchResult` carries
 * `{ id, distance, similarity, metadata }`). Declared inline so the handler
 * does not import `SearchResult`; the `metadata` map carries the
 * `MemoryEntryShape`-derived fields the `store.ts` handler writes
 * (`namespace`, `key`, `content`, `tags`, ...).
 */
interface VectorSearchHit {
  readonly id: string;
  readonly distance?: number;
  readonly similarity?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export const searchMemoryHandler: GuardedRead<MemorySearchQuery, RankedResults<MemoryRecord>> =
  registerReadHandler<MemorySearchQuery, RankedResults<MemoryRecord>>(
    'memory_search',
    async (ctx: ReadContext, payload: MemorySearchQuery): Promise<RankedResults<MemoryRecord>> => {
      const threshold = payload.threshold ?? 0.3;
      const limit = payload.limit ?? 10;
      const ns = payload.namespace && payload.namespace !== 'all' ? payload.namespace : undefined;

      // Empty query text is a miss (cli parity: `bm25Rank` throws on empty
      // tokens at memory-router.ts:1172; the semantic path would embed an
      // empty string and rank no-better than random). `feedback-no-fallbacks`:
      // surface the no-results outcome rather than synthesize a result set.
      if (!payload.text) return [];

      // Generate the query embedding via the read-side EmbeddingScorer
      // capability (ADR-0069 unified mpnet pipeline; same model the cli's
      // store path uses to mint storage embeddings — keeps query/document
      // vector spaces aligned).
      //
      // ADR-0181 task #100 root-cause fix: pass {intent: 'query'} so the
      // asymmetric task-prefix matches the read-side semantics. mpnet/bge
      // encode queries with a different prefix than documents — embedding
      // the query with a document prefix puts it in the wrong subspace and
      // tanks recall. The store-side (memory_store handler) leaves intent
      // unset (defaults to 'document'), which is correct for stored content.
      const scorer = ctx.capabilities.requireEmbeddingScorer();
      const queryVector = await scorer.embed(payload.text, { intent: 'query' });

      // Widen topK when scoped to a single namespace so the post-filter has
      // headroom. `limit` stays the final slice.
      const topK = ns ? limit * NS_OVERFETCH : limit;
      const hits = await ctx.substrate.vectorSearch<VectorSearchHit>({
        storeId: STORE_ID,
        vector: queryVector,
        topK,
      });

      const ranked: RankedResult<MemoryRecord>[] = [];
      for (const hit of hits) {
        const meta = hit.item.metadata ?? {};
        const recordNamespace = typeof meta.namespace === 'string' ? meta.namespace : '';
        if (ns !== undefined && recordNamespace !== ns) continue;
        const score = hit.score;
        if (score < threshold) continue;
        const recordKey = typeof meta.key === 'string' ? meta.key : '';
        const recordContent = typeof meta.content === 'string' ? meta.content : '';
        // ADR-0181 task #100 (cli-flip prep) — surface tags off the merged
        // metadata (Fix A in memory-rvf-adapter.ts) so cli callers iterating
        // `entry.tags` never NPE on dispatched search hits. `tags` defaults
        // to [] when the metadata field is missing or non-array.
        const rawTags = meta.tags;
        const recordTags = Array.isArray(rawTags)
          ? rawTags.filter((t): t is string => typeof t === 'string')
          : [];
        const record: MemoryRecord = {
          id: hit.item.id,
          namespace: recordNamespace,
          key: recordKey,
          content: recordContent,
          score,
          metadata: { ...meta },
          tags: recordTags,
        };
        ranked.push({
          item: record,
          score,
          provenance: {
            storeId: STORE_ID as string,
            matchType: 'semantic',
            rawScore: score,
            rank: ranked.length + 1,
            matchedField: 'content',
          },
        });
        if (ranked.length >= limit) break;
      }

      return ranked;
    },
    { cacheScope: 'namespace' },
  );
