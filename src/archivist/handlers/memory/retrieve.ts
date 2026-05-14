// charter: dispatch
// memory_retrieve read handler (ADR-0180 Phase 3, §Architecture · Read-path return shape).
// Registers as `GuardedRead<MemoryRetrieveQuery, RankedResults<MemoryRecord>>` so
// even single-entry reads carry provenance verbatim. `key` resolves an exact
// (namespace, key) lookup; `id` resolves by storage row id; `limit` caps the
// returned set (the legacy memory_retrieve tool returns at most one entry, but
// shape parity with search avoids a second result type).

import { registerReadHandler, type GuardedRead, type ReadContext } from '../../index';
import type { MemoryRecord, RankedResults } from './search';

export interface MemoryRetrieveQuery {
  readonly namespace?: string;
  readonly key?: string;
  readonly id?: string;
  readonly limit?: number;
}

// TODO(ADR-0180 Phase 3 wire-up): port the exact-key + by-id retrieval body from
// memory-router.ts `case 'get'` (storage.getByKey + JSON-value reparse). The
// router branch stays in place until the dispatch boundary is wired through
// cli; this handler is the registration shape the dispatch path will resolve.
export const retrieveMemoryHandler: GuardedRead<MemoryRetrieveQuery, RankedResults<MemoryRecord>> =
  registerReadHandler<MemoryRetrieveQuery, RankedResults<MemoryRecord>>(
    'memory_retrieve',
    async (_ctx: ReadContext, _payload: MemoryRetrieveQuery): Promise<RankedResults<MemoryRecord>> => {
      throw new Error(
        'archivist: memory_retrieve handler body pending Phase 3 wire-up; ' +
        'callers currently route through cli/src/memory/memory-router.ts case \'get\'',
      );
    },
    { cacheScope: 'namespace' },
  );
