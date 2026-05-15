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
// reflecting the 1-based, offset-inclusive position. The cli pre-shapes the
// same envelope verbatim (memory-tools.ts:688-699 — `{ storeId: 'memory_store',
// matchType: 'exact', rawScore: 0, rank: offset + index + 1 }`). No
// `matchedField` — cli omits it; strict cli-parity per Phase 3 DA ruling
// (round 2, item 4).
//
// ADR-0181 Phase 3 Amendment (2026-05-15): the cli's `routeMemoryOp` case 'list'
// (memory-router.ts:1249 — `storage.query` with offset+limit against the RVF
// backend) stays authoritative during the migration window. This handler reads
// from the same FS-JSON candidate store the search/retrieve handlers consume;
// Phase 4 collapses the indirection when the cli boundary flips through the
// archivist.
//
// TODO(ADR-0181 Phase 4): until the cli→agentdb RVF adapter is wired and the
// `memory_search_index` FS-JSON store is populated by the cli's `routeMemoryOp`
// case 'list', this handler returns an empty RankedResults for every dispatched
// read — the provenance shape is preserved and the registration is live, but
// no entries ever exist to enumerate. The cli's tool handler at memory-tools.ts
// :646-718 stays authoritative until Phase 4 flips the dispatch boundary.

import { registerReadHandler, type GuardedRead, type ReadContext, type StoreId } from '../../index.js';
import type { RankedResult, RankedResults } from './search.js';

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

const STORE_ID = 'memory_search_index' as StoreId;

/**
 * On-disk FS-JSON document shape. The `entries` field is shaped exactly like
 * the cli's `routeMemoryOp` case 'list' return — key/namespace + storage
 * timestamps + access counters + embedding presence + serialized size. The cli
 * writes this snapshot ahead of dispatch (Phase 3 migration window).
 */
interface MemoryListStore {
  readonly entries: ReadonlyArray<MemoryListRecord>;
}

export const listMemoryHandler: GuardedRead<MemoryListQuery, RankedResults<MemoryListRecord>> =
  registerReadHandler<MemoryListQuery, RankedResults<MemoryListRecord>>(
    'memory_list',
    async (ctx: ReadContext, payload: MemoryListQuery): Promise<RankedResults<MemoryListRecord>> => {
      const store = await ctx.substrate.read<MemoryListStore>({ storeId: STORE_ID, key: 'root' });
      const all = store?.entries ?? [];

      // ADR-0094 Sprint 1.4 (d9) parity: pass-through "no namespace filter" when
      // the caller omits/empties namespace OR uses the 'all' sentinel. Scoped
      // calls keep their namespace filter intact.
      const ns = payload.namespace && payload.namespace !== 'all' ? payload.namespace : undefined;
      const limit = payload.limit ?? 50;
      const offset = payload.offset ?? 0;

      const filtered = ns ? all.filter((e) => e.namespace === ns) : all.slice();
      const paged = filtered.slice(offset, offset + limit);

      return paged.map((entry, index): RankedResult<MemoryListRecord> => ({
        item: entry,
        score: 0,
        provenance: {
          storeId: 'memory_store',
          matchType: 'exact',
          rawScore: 0,
          rank: offset + index + 1,
        },
      }));
    },
    { cacheScope: 'namespace' },
  );
