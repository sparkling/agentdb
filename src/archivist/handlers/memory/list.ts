// charter: dispatch
// memory_list read handler (ADR-0180 Phase 3, §Architecture · Read-path return shape).
// Registers as `GuardedRead<MemoryListQuery, RankedResults<MemoryListRecord>>` so
// even enumeration reads carry provenance verbatim — the cli-side flag
// `includeProvenance: true` exposes the full RankedResult shape; the legacy
// `{ entries: [...] }` shape stays the default for back-compat.
//
// memory_list is an enumeration, not a similarity rank. Per ADR-0180 §Read-path
// return shape, that means matchType: 'exact' (the closest member of the
// existing closed Provenance union in ./search) with rawScore: 0 and rank
// reflecting the 1-based, offset-inclusive position.

import { registerReadHandler, type GuardedRead, type ReadContext } from '../../index';
import type { RankedResults } from './search';

export interface MemoryListQuery {
  readonly namespace?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface MemoryListRecord {
  readonly key: string;
  readonly namespace: string;
  readonly storedAt?: string;
  readonly updatedAt?: string;
  readonly accessCount?: number;
  readonly hasEmbedding?: boolean;
  readonly size?: number;
}

// TODO(ADR-0180 Phase 3 wire-up): port the enumeration body from
// memory-router.ts `case 'list'` (storage.query with offset+limit). The router
// branch stays in place until the dispatch boundary is wired through cli; this
// handler is the registration shape the dispatch path will resolve.
export const listMemoryHandler: GuardedRead<MemoryListQuery, RankedResults<MemoryListRecord>> =
  registerReadHandler<MemoryListQuery, RankedResults<MemoryListRecord>>(
    'memory_list',
    async (_ctx: ReadContext, _payload: MemoryListQuery): Promise<RankedResults<MemoryListRecord>> => {
      throw new Error(
        'archivist: memory_list handler body pending Phase 3 wire-up; ' +
        'callers currently route through cli/src/memory/memory-router.ts case \'list\'',
      );
    },
    { cacheScope: 'namespace' },
  );
