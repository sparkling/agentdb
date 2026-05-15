// charter: dispatch
// memory_retrieve read handler (ADR-0180 Phase 3, §Architecture · Read-path return shape).
// Registers as `GuardedRead<MemoryRetrieveQuery, RankedResults<MemoryRecord>>` so
// even single-entry reads carry provenance verbatim. `key` resolves an exact
// (namespace, key) lookup; `id` resolves by storage row id. The legacy
// memory_retrieve tool returns at most one entry, so we return either a
// 1-element ranked-results array on hit, or an empty array on miss — shape
// parity with `memory_search` avoids a second result type.
//
// ADR-0181 Phase 3 Amendment (2026-05-15): the cli's `routeMemoryOp` case 'get'
// (memory-router.ts:1223 — `storage.getByKey` + JSON-value reparse against the
// RVF backend) stays authoritative during the migration window. This handler
// reads from the same FS-JSON candidate store `memory_search` does (cli writes
// candidates ahead of dispatch); a key match is a `rawScore: 1` exact hit per
// ADR-0180 §Provenance rollout scope.
//
// Provenance shape mirrors the cli's pre-shaped envelope verbatim
// (memory-tools.ts:347-356):
//   { storeId: 'memory_store', matchType: 'exact', rawScore: 1, rank: 1 }
// No `matchedField` — cli omits it; strict cli-parity per Phase 3 DA ruling
// (round 2, item 4). The cli surface uses storeId='memory_store' (the canonical
// RVF content store) for back-compat with existing scripts that inspect the
// provenance fields directly. Phase 4 collapses the indirection when the cli
// boundary flips through the archivist.
//
// TODO(ADR-0181 Phase 4): until the cli→agentdb RVF adapter is wired and the
// `memory_search_index` FS-JSON store is populated, this handler returns an
// empty RankedResults for every dispatched read — the provenance shape is
// preserved and the registration is live, but no real candidate ever matches.
// The cli's tool handler at memory-tools.ts:303-375 stays authoritative until
// Phase 4 flips the dispatch boundary.

import { registerReadHandler, type GuardedRead, type ReadContext, type StoreId } from '../../index.js';
import type { MemoryRecord, RankedResult, RankedResults } from './search.js';

export interface MemoryRetrieveQuery {
  readonly namespace?: string;
  readonly key?: string;
  readonly id?: string;
  readonly limit?: number;
}

const STORE_ID = 'memory_search_index' as StoreId;

interface MemoryRetrieveStore {
  readonly candidates: ReadonlyArray<MemoryRecord>;
}

export const retrieveMemoryHandler: GuardedRead<MemoryRetrieveQuery, RankedResults<MemoryRecord>> =
  registerReadHandler<MemoryRetrieveQuery, RankedResults<MemoryRecord>>(
    'memory_retrieve',
    async (ctx: ReadContext, payload: MemoryRetrieveQuery): Promise<RankedResults<MemoryRecord>> => {
      const store = await ctx.substrate.read<MemoryRetrieveStore>({ storeId: STORE_ID, key: 'root' });
      const corpus = store?.candidates ?? [];

      const ns = payload.namespace && payload.namespace !== 'all' ? payload.namespace : undefined;

      // Match priority: explicit id wins; otherwise (namespace, key) exact match.
      // Both filters are pure equality — matchType: 'exact' per ADR-0180 §Read-path
      // return shape (the closed Provenance union in ./search).
      const matched = corpus.find((r) => {
        if (payload.id !== undefined && r.id === payload.id) return true;
        if (payload.key !== undefined) {
          if (r.key !== payload.key) return false;
          if (ns !== undefined && r.namespace !== ns) return false;
          return true;
        }
        return false;
      });

      if (!matched) return [];

      const hit: RankedResult<MemoryRecord> = {
        item: matched,
        score: 1,
        provenance: {
          storeId: 'memory_store',
          matchType: 'exact',
          rawScore: 1,
          rank: 1,
        },
      };
      return [hit];
    },
    { cacheScope: 'namespace' },
  );
