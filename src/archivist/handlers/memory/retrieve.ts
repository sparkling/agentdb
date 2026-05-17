// charter: dispatch
// memory_retrieve read handler (ADR-0180 Phase 3, §Architecture · Read-path return shape).
// Registers as `GuardedRead<MemoryRetrieveQuery, RankedResults<MemoryRecord>>` so
// even single-entry reads carry provenance verbatim. `key` resolves an exact
// (namespace, key) lookup via the substrate's `getByKey` (ADR-0181 task #99
// commit 2). The legacy memory_retrieve tool returns at most one entry, so we
// return either a 1-element ranked-results array on hit, or an empty array on
// miss — shape parity with `memory_search` avoids a second result type.
//
// ADR-0181 task #99 commit 2 (2026-05-17): STORE_ID flipped from
// `memory_search_index` (FS-JSON, never populated in production) to
// `memory_store` (the canonical RVF content store the `memory_store` write
// handler persists into). The read path now collapses to the same RVF backend
// the cli's `routeMemoryOp` case 'get' (memory-router.ts:1223 —
// `storage.getByKey(namespace, key)`) reads from — closing the longstanding
// "PHASE 6+: route through archivist when memory_search_index→memory_store
// collapse lands" gap flagged at memory-tools.ts:384/500/750/1179.
//
// Provenance shape mirrors the cli's pre-shaped envelope verbatim
// (memory-tools.ts:347-356):
//   { storeId: 'memory_store', matchType: 'exact', rawScore: 1, rank: 1 }
// No `matchedField` — cli omits it; strict cli-parity per Phase 3 DA ruling
// (round 2, item 4).
//
// `id` field on the payload is a legacy parameter (the prior FS-JSON corpus
// could be addressed by storage row id). The substrate's `getByKey` exposes
// `(namespace, key)` only — the production cli has never had an id-only path
// (`routeMemoryOp` case 'get' takes only namespace+key). When `key` is absent,
// the handler returns an empty RankedResults rather than synthesizing an
// alternative lookup — `feedback-no-fallbacks`.

import { registerReadHandler } from '../../registration.js';
import type { GuardedRead, ReadContext, StoreId } from '../../index.js';
import type { MemoryRecord, RankedResult, RankedResults } from './search.js';

export interface MemoryRetrieveQuery {
  readonly namespace?: string;
  readonly key?: string;
  readonly id?: string;
  readonly limit?: number;
}

const STORE_ID = 'memory_store' as StoreId;

/**
 * Shape the substrate's `getByKey` yields for the `memory_store` RVF backend
 * (the `MemoryEntryShape` the cli's `RvfBackend.getByKey` returns). Declared
 * inline so the handler does not import the adapter type; only the fields the
 * handler maps to `MemoryRecord` are listed.
 *
 * ADR-0181 task #100 (cli-flip prep) — widened to expose `tags`,
 * `accessCount`, `embedding`. The pre-flip cli envelope at
 * `cli/src/mcp-tools/memory-tools.ts:405-416` surfaces these on the retrieve
 * response (`tags`, `accessCount`, `hasEmbedding`); dropping them caused
 * `cli memory retrieve` to crash on `entry.tags.length` against the
 * dispatched read path. `embedding` is read only to derive `hasEmbedding`
 * (boolean) for the projected `MemoryRecord` — the raw Float32Array does not
 * leak past the handler boundary.
 */
interface MemoryStoreRecord {
  readonly id: string;
  readonly key: string;
  readonly namespace: string;
  readonly content: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly tags?: readonly string[];
  readonly accessCount?: number;
  readonly embedding?: Float32Array;
}

export const retrieveMemoryHandler: GuardedRead<MemoryRetrieveQuery, RankedResults<MemoryRecord>> =
  registerReadHandler<MemoryRetrieveQuery, RankedResults<MemoryRecord>>(
    'memory_retrieve',
    async (ctx: ReadContext, payload: MemoryRetrieveQuery): Promise<RankedResults<MemoryRecord>> => {
      // Substrate `getByKey` requires both namespace and key. Cli parity
      // (memory-router.ts:1225 — `storage.getByKey(namespace || 'default', key || '')`):
      // namespace defaults to 'default'; empty key is a miss (no synthesized
      // alternative lookup — `feedback-no-fallbacks`).
      const key = payload.key;
      if (key === undefined || key === '') return [];
      const namespace =
        payload.namespace && payload.namespace !== 'all' ? payload.namespace : 'default';

      const entry = await ctx.substrate.getByKey<MemoryStoreRecord>({
        storeId: STORE_ID,
        namespace,
        key,
      });
      if (!entry) return [];

      const hit: RankedResult<MemoryRecord> = {
        item: {
          id: entry.id,
          namespace: entry.namespace,
          key: entry.key,
          content: entry.content,
          score: 1,
          metadata: entry.metadata ? { ...entry.metadata } : undefined,
          // ADR-0181 task #100 (cli-flip prep) — surface cli pre-flip
          // envelope fields. `tags` defaults to `[]` so cli callers iterating
          // `entry.tags.length` never NPE. `accessCount` defaults to 0 when
          // the backend does not track it. `hasEmbedding` is computed from
          // the raw Float32Array presence so the response is uniform across
          // backends that may or may not carry embeddings.
          tags: entry.tags ? [...entry.tags] : [],
          accessCount: typeof entry.accessCount === 'number' ? entry.accessCount : 0,
          hasEmbedding: !!entry.embedding,
        },
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
