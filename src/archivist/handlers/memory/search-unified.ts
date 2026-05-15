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
// pre-dedup rank cannot. No `RRF(k=60)` math in the body — it would be dead code
// over an empty / single-store corpus until Phase 4 wires the multi-store writer.
//
// TODO(ADR-0181 Phase 4): until the cli→agentdb RVF adapter is wired and the
// `memory_search_index` FS-JSON store is populated by the cli's `memory_search_unified`
// path (memory-tools.ts:1078-1109), this handler returns an empty RankedResults
// for every dispatched read — the provenance shape is preserved and the
// registration is live, but no real candidate ever materializes. The cli's tool
// handler at memory-tools.ts:1065-1136 stays authoritative until Phase 4 flips
// the dispatch boundary.

import { registerReadHandler, type GuardedRead, type ReadContext, type StoreId } from '../../index.js';
import type { MemoryRecord, RankedResult, RankedResults } from './search.js';

export interface MemorySearchUnifiedQuery {
  readonly query: string;
  readonly limit?: number;
  readonly namespace?: string;
  readonly threshold?: number;
}

const STORE_ID = 'memory_search_index' as StoreId;

/**
 * On-disk FS-JSON candidate shape — same store the `memory_search` /
 * `memory_retrieve` handlers consume, but each candidate carries an optional
 * `source` field that discriminates the contributing store ('agentdb',
 * 'claude-code', 'auto-memory', etc.) for cross-store provenance attribution.
 * The cli writes this shape ahead of dispatch (memory-tools.ts:1095 derives
 * `source` from the searched namespace).
 */
interface UnifiedCandidate extends MemoryRecord {
  readonly source?: string;
}

interface MemorySearchUnifiedStore {
  readonly candidates: ReadonlyArray<UnifiedCandidate>;
}

export const searchUnifiedMemoryHandler: GuardedRead<MemorySearchUnifiedQuery, RankedResults<MemoryRecord>> =
  registerReadHandler<MemorySearchUnifiedQuery, RankedResults<MemoryRecord>>(
    'memory_search_unified',
    async (ctx: ReadContext, payload: MemorySearchUnifiedQuery): Promise<RankedResults<MemoryRecord>> => {
      const store = await ctx.substrate.read<MemorySearchUnifiedStore>({ storeId: STORE_ID, key: 'root' });
      const corpus = store?.candidates ?? [];

      const ns = payload.namespace && payload.namespace !== 'all' ? payload.namespace : undefined;
      const threshold = payload.threshold ?? 0;
      const limit = payload.limit ?? 10;

      // Capture per-store pre-dedup rank BEFORE the global sort+dedup. Cli does
      // this in `.forEach((entry, idx)` at memory-tools.ts:1092 — `idx` is the
      // per-namespace 0-based position. Group candidates by source store first,
      // then assign per-store rank in raw-score order.
      const byStore = new Map<string, UnifiedCandidate[]>();
      for (const cand of corpus) {
        if (ns && cand.namespace !== ns) continue;
        if (cand.score < threshold) continue;
        const source = cand.source ?? cand.namespace;
        const bucket = byStore.get(source);
        if (bucket) bucket.push(cand);
        else byStore.set(source, [cand]);
      }

      // Stamp per-store 0-based pre-dedup rank on each candidate via a side
      // map (substrate-immutability per Phase 2 carry-forward — never mutate
      // the candidate refs returned from substrate.read).
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
      const allCandidates = corpus.filter((c) => perStoreRank.has(c)).slice();
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
