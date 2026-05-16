// charter: dispatch
// memory_search read handler (ADR-0180 Phase 3, §Architecture · Read-path return shape).
// Registers as `GuardedRead<MemorySearchQuery, RankedResults<MemoryRecord>>` so
// every candidate carries provenance verbatim. cli-side flattening (legacy
// `{id, content, score}[]`) vs full RankedResult shape is gated by the
// includeProvenance parameter wired at the cli boundary (memory-tools.ts).
//
// ADR-0181 Phase 3 Amendment (2026-05-15): the cli's RVF-backed `routeMemoryOp`
// case 'search' (memory-router.ts:1094 — BM25/ONNX/hash-fallback fusion, MMR
// diversity, AttentionService boost) stays authoritative during the migration
// window. This handler reads from a separate FS-JSON candidate store the cli
// writes to ahead of dispatch — Phase 4 inherits the RVF-substrate wire-up
// (cli → agentdb-typed `RvfBackend` adapter) which collapses this two-store
// shape back to a single `ctx.substrate.vectorSearch` against `memory_store`.
//
// STORE_ID `memory_search_index` is FS-JSON-classified (not in RVF_STORE_IDS /
// SQLITE_CARVE_OUT_STORE_IDS — falls through to the structural default in
// substrate-registry.ts `classifyStore`). The cli's QueryOptimizer + MetadataFilter
// + MMRDiversityRanker + AttentionService composition is OUT OF SCOPE here —
// those branch on the cli controllers, not on the substrate seam; they re-enter
// in the Phase 4 cli boundary flip.
//
// Response-envelope split (Phase 3 DA ruling, round 2, item 7): the cli's tool
// response wrapper — `{ query, results, total, searchTime, backend, attention,
// ...synthesis? }` (memory-tools.ts:556-564) — is constructed at the cli
// boundary POST-dispatchRead, NOT in this handler. This handler returns ONLY
// `RankedResults<MemoryRecord>` (the array). Phase 4's cli boundary flip
// preserves the split: the cli tool handler calls `dispatch('memory_search', q)`
// to get the ranked array, then wraps it with timing/backend/attention metadata
// before returning to the MCP edge. The handler must not widen its return type.
//
// TODO(ADR-0181 Phase 4): until the cli→agentdb RVF adapter is wired and the
// `memory_search_index` FS-JSON store is populated by the cli's `routeMemoryOp`
// case 'search', this handler returns an empty RankedResults for every
// dispatched read — the provenance shape is preserved and the registration is
// live, but no real candidates ever materialize. The cli's tool handler at
// memory-tools.ts:397-583 stays authoritative until Phase 4 flips the dispatch
// boundary.

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

const STORE_ID = 'memory_search_index' as StoreId;

/**
 * On-disk FS-JSON document the `memory_search` substrate owns. The cli writes a
 * candidate corpus into this store ahead of dispatch (Phase 3 migration window).
 * Each candidate carries a precomputed `score` (the semantic similarity captured
 * at write time by the cli's embedding pipeline) so the read path is a
 * lock-free filter+rank+shape — no vector math here.
 */
interface MemorySearchStore {
  readonly candidates: ReadonlyArray<MemoryRecord>;
}

export const searchMemoryHandler: GuardedRead<MemorySearchQuery, RankedResults<MemoryRecord>> =
  registerReadHandler<MemorySearchQuery, RankedResults<MemoryRecord>>(
    'memory_search',
    async (ctx: ReadContext, payload: MemorySearchQuery): Promise<RankedResults<MemoryRecord>> => {
      const store = await ctx.substrate.read<MemorySearchStore>({ storeId: STORE_ID, key: 'root' });
      const corpus = store?.candidates ?? [];

      const threshold = payload.threshold ?? 0.3;
      const limit = payload.limit ?? 10;
      const ns = payload.namespace && payload.namespace !== 'all' ? payload.namespace : undefined;

      const ranked = corpus
        .filter((r) => (ns ? r.namespace === ns : true))
        .filter((r) => r.score >= threshold)
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return ranked.map((record, index): RankedResult<MemoryRecord> => ({
        item: record,
        score: record.score,
        provenance: {
          storeId: STORE_ID as string,
          matchType: 'semantic',
          rawScore: record.score,
          rank: index + 1,
          matchedField: 'content',
        },
      }));
    },
    { cacheScope: 'namespace' },
  );
