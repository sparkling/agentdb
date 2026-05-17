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
// ADR-0181 task #99 commit 2 (2026-05-17): STORE_ID flipped from
// `memory_search_index` (FS-JSON, never populated in production) to
// `memory_store` (the canonical RVF content store the `memory_store` write
// handler persists into). The handler now uses the substrate's `list`
// operation (commit 1) which delegates to `MemoryRvfAdapter.queryAsync` →
// `RvfBackend.query` — the same vectorless scan the cli's `routeMemoryOp` case
// 'list' (memory-router.ts:1278 — `storage.query({type: 'prefix', namespace,
// limit, offset})`) drives in production today. Records returned by the
// substrate carry the full `MemoryEntryShape`; the handler narrows to the
// `MemoryListRecord` projection the cli envelope expects.

import { registerReadHandler } from '../../registration.js';
import type { GuardedRead, ReadContext, StoreId } from '../../index.js';
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

const STORE_ID = 'memory_store' as StoreId;

/**
 * Shape the substrate's `list` yields for the `memory_store` RVF backend
 * (the `MemoryEntryShape` the cli's `RvfBackend.query` returns). Declared
 * inline so the handler does not import the adapter type; only the fields the
 * handler maps to `MemoryListRecord` are listed. `createdAt` / `updatedAt`
 * are unix-millis on the wire; the handler converts to ISO strings for the
 * cli envelope's `storedAt` / `updatedAt` fields.
 */
interface MemoryStoreRecord {
  readonly key: string;
  readonly namespace: string;
  readonly content: string;
  readonly embedding?: Float32Array;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly accessCount?: number;
}

export const listMemoryHandler: GuardedRead<MemoryListQuery, RankedResults<MemoryListRecord>> =
  registerReadHandler<MemoryListQuery, RankedResults<MemoryListRecord>>(
    'memory_list',
    async (ctx: ReadContext, payload: MemoryListQuery): Promise<RankedResults<MemoryListRecord>> => {
      // ADR-0094 Sprint 1.4 (d9) parity: pass-through "no namespace filter" when
      // the caller omits/empties namespace OR uses the 'all' sentinel. Scoped
      // calls keep their namespace filter intact.
      const ns = payload.namespace && payload.namespace !== 'all' ? payload.namespace : undefined;
      const limit = payload.limit ?? 50;
      const offset = payload.offset ?? 0;

      const entries = await ctx.substrate.list<MemoryStoreRecord>({
        storeId: STORE_ID,
        ...(ns !== undefined ? { namespace: ns } : {}),
        limit,
        offset,
      });

      return entries.map((entry, index): RankedResult<MemoryListRecord> => ({
        item: {
          key: entry.key,
          namespace: entry.namespace,
          ...(typeof entry.createdAt === 'number'
            ? { storedAt: new Date(entry.createdAt).toISOString() }
            : {}),
          ...(typeof entry.updatedAt === 'number'
            ? { updatedAt: new Date(entry.updatedAt).toISOString() }
            : {}),
          ...(typeof entry.accessCount === 'number' ? { accessCount: entry.accessCount } : {}),
          hasEmbedding: !!entry.embedding,
          size: entry.content ? entry.content.length : 0,
        },
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
