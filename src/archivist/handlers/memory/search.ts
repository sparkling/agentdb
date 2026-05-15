// charter: dispatch
// memory_search read handler (ADR-0180 Phase 3, §Architecture · Read-path return shape).
// Registers as `GuardedRead<MemorySearchQuery, RankedResults<MemoryRecord>>` so
// every candidate carries provenance verbatim. cli-side flattening (legacy
// `{id, content, score}[]`) vs full RankedResult shape is gated by the
// includeProvenance parameter wired separately by provenance-rollout-worker-search.

import { registerReadHandler, type GuardedRead, type ReadContext } from '../../index.js';

export interface MemorySearchQuery {
  readonly namespace?: string;
  readonly text: string;
  readonly limit?: number;
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

// TODO(ADR-0180 Phase 3 wire-up): port the BM25/semantic fusion body from
// memory-router.ts `case 'search'` (RVF + SQLite paths, BM25 hash-fallback,
// MMR diversity, AttentionService boost). The router branch stays in place
// until the dispatch boundary is wired through cli; this handler is the
// registration shape the dispatch path will resolve.
export const searchMemoryHandler: GuardedRead<MemorySearchQuery, RankedResults<MemoryRecord>> =
  registerReadHandler<MemorySearchQuery, RankedResults<MemoryRecord>>(
    'memory_search',
    async (_ctx: ReadContext, _payload: MemorySearchQuery): Promise<RankedResults<MemoryRecord>> => {
      throw new Error(
        'archivist: memory_search handler body pending Phase 3 wire-up; ' +
        'callers currently route through cli/src/memory/memory-router.ts case \'search\'',
      );
    },
    { cacheScope: 'namespace' },
  );
