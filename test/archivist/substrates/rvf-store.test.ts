// charter: substrate-seam
// ADR-0181 task #99 commit 1 — `getByKey` + `list` unit tests for the
// production `makeRvfSubstrate` factory.
//
// The RVF substrate delegates these ops to the wired backend's adapter
// methods: `getByKeyAsync(ns, key)` (O(1) Map lookup in the cli's RvfBackend)
// and `queryAsync({namespace, limit, offset})` (vectorless filter scan over
// the cli's `RvfBackend.query`). These tests substitute a `MemoryRvfAdapter`
// fixture wired over an in-memory `IMemoryRvfBackend` stub — faithful to the
// production wiring path without depending on `@ruvector/rvf` or on-disk RVF
// state.
//
// The fail-loud branch (backend missing `getByKeyAsync` / `queryAsync`) is
// also exercised — a non-`MemoryRvfAdapter` VectorBackendAsync wired into the
// substrate must surface a "wiring gap" error, not a silent empty result
// (`feedback-no-fallbacks`).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeRvfSubstrate } from '../../../src/archivist/substrates/rvf-store.js';
import { MemoryRvfAdapter } from '../../../src/adapters/memory-rvf-adapter.js';
import type {
  IMemoryRvfBackend,
  MemoryEntryShape,
  MemorySearchOptionsShape,
  MemorySearchResultShape,
  MemoryBackendStatsShape,
} from '../../../src/adapters/memory-rvf-adapter.js';
import type { VectorBackendAsync, SearchResult, VectorStats } from '../../../src/backends/VectorBackend.js';
import type {
  ReadCapableSubstrate,
  StoreId,
  SubstrateAccess,
} from '../../../src/archivist/types.js';

const STORE_ID = 'memory_store' as StoreId;
const DIM = 4;

function asReadable(access: SubstrateAccess): ReadCapableSubstrate {
  return access as unknown as ReadCapableSubstrate;
}

/**
 * In-memory IMemoryRvfBackend stub. Implements every method the adapter
 * needs (the structural-contract check from memory-rvf-adapter.test.ts) but
 * focuses on the ones the substrate exercises: store / getByKey / query /
 * listNamespaces.
 */
function makeMemoryBackendStub(): IMemoryRvfBackend & {
  readonly entries: Map<string, MemoryEntryShape>;
} {
  const entries = new Map<string, MemoryEntryShape>();
  return {
    entries,
    async initialize(): Promise<void> {},
    async shutdown(): Promise<void> {
      entries.clear();
    },
    async store(entry: MemoryEntryShape): Promise<void> {
      entries.set(entry.id, entry);
    },
    async bulkInsert(items: readonly MemoryEntryShape[]): Promise<void> {
      for (const e of items) entries.set(e.id, e);
    },
    async search(
      _embedding: Float32Array,
      _options: MemorySearchOptionsShape,
    ): Promise<readonly MemorySearchResultShape[]> {
      return [];
    },
    async delete(id: string): Promise<boolean> {
      return entries.delete(id);
    },
    async getStats(): Promise<MemoryBackendStatsShape> {
      return { totalEntries: entries.size, memoryUsage: 0 };
    },
    async getStoredDimension(): Promise<number> {
      return DIM;
    },
    async getByKey(namespace: string, key: string): Promise<MemoryEntryShape | null> {
      for (const e of entries.values()) {
        if (e.namespace === namespace && e.key === key) return e;
      }
      return null;
    },
    async update(): Promise<MemoryEntryShape | null> {
      return null;
    },
    async query(q): Promise<readonly MemoryEntryShape[]> {
      let rows = Array.from(entries.values());
      if (q.namespace !== undefined) rows = rows.filter((e) => e.namespace === q.namespace);
      // Sort by createdAt ascending so pagination is deterministic.
      rows.sort((a, b) => a.createdAt - b.createdAt);
      const offset = q.offset ?? 0;
      return rows.slice(offset, offset + q.limit);
    },
    async listNamespaces(): Promise<readonly string[]> {
      const ns = new Set<string>();
      for (const e of entries.values()) ns.add(e.namespace);
      return Array.from(ns);
    },
  };
}

/** Minimal `VectorBackendAsync` that does NOT extend MemoryRvfAdapter — for the
 *  fail-loud wiring-gap path. Every method is a no-op or empty. */
function makeNonAdapterBackend(): VectorBackendAsync {
  const stats: VectorStats = {
    count: 0,
    dimension: DIM,
    metric: 'cosine',
    backend: 'rvf',
    memoryUsage: 0,
  };
  return {
    name: 'rvf',
    async insertAsync(): Promise<void> {},
    async insertBatchAsync(): Promise<void> {},
    async searchAsync(): Promise<SearchResult[]> {
      return [];
    },
    async removeAsync(): Promise<boolean> {
      return false;
    },
    async getStatsAsync(): Promise<VectorStats> {
      return stats;
    },
    async flush(): Promise<void> {},
    insert(): void {},
    insertBatch(): void {},
    search(): SearchResult[] {
      return [];
    },
    remove(): boolean {
      return false;
    },
    getStats(): VectorStats {
      return stats;
    },
    async save(): Promise<void> {},
    async load(): Promise<void> {},
    close(): void {},
  };
}

describe('makeRvfSubstrate — getByKey + list (ADR-0181 task #99 commit 1)', () => {
  let backend: ReturnType<typeof makeMemoryBackendStub>;
  let adapter: MemoryRvfAdapter;
  let access: SubstrateAccess;

  beforeEach(() => {
    backend = makeMemoryBackendStub();
    adapter = new MemoryRvfAdapter(backend, { dimension: DIM });
    access = makeRvfSubstrate(adapter);
  });

  afterEach(() => {
    backend.entries.clear();
  });

  /** Seed the backend with N entries spread across namespaces. */
  async function seed(rows: ReadonlyArray<{
    id: string;
    namespace: string;
    key: string;
    content: string;
    createdAt?: number;
  }>): Promise<void> {
    let now = 1_000_000;
    for (const r of rows) {
      const entry: MemoryEntryShape = {
        id: r.id,
        key: r.key,
        content: r.content,
        type: 'semantic',
        namespace: r.namespace,
        tags: [],
        metadata: {},
        accessLevel: 'private',
        createdAt: r.createdAt ?? now++,
        updatedAt: r.createdAt ?? now,
        version: 1,
        references: [],
        accessCount: 0,
        lastAccessedAt: r.createdAt ?? now,
      };
      await backend.store(entry);
    }
  }

  describe('getByKey', () => {
    it('returns the matching entry on (namespace, key) hit', async () => {
      await seed([
        { id: 'a', namespace: 'ns-1', key: 'k-1', content: 'v1' },
        { id: 'b', namespace: 'ns-1', key: 'k-2', content: 'v2' },
        { id: 'c', namespace: 'ns-2', key: 'k-1', content: 'v3' },
      ]);

      const result = await asReadable(access).getByKey<MemoryEntryShape>({
        storeId: STORE_ID,
        namespace: 'ns-1',
        key: 'k-2',
      });

      expect(result).toBeDefined();
      expect(result?.id).toBe('b');
      expect(result?.content).toBe('v2');
    });

    it('returns undefined on a miss (adapter `null` → substrate `undefined`)', async () => {
      await seed([{ id: 'a', namespace: 'ns-1', key: 'k-1', content: 'v1' }]);
      const result = await asReadable(access).getByKey<MemoryEntryShape>({
        storeId: STORE_ID,
        namespace: 'ns-1',
        key: 'k-missing',
      });
      expect(result).toBeUndefined();
    });

    it('throws fail-loud when the backend lacks getByKeyAsync (wiring gap)', async () => {
      const naked = makeRvfSubstrate(makeNonAdapterBackend());
      await expect(
        asReadable(naked).getByKey({ storeId: STORE_ID, namespace: 'n', key: 'k' }),
      ).rejects.toThrow(/getByKey is not available.*getByKeyAsync.*MemoryRvfAdapter/s);
    });
  });

  describe('list', () => {
    it('without filters returns every entry (capped at default limit 1000)', async () => {
      await seed([
        { id: 'a', namespace: 'ns-1', key: 'k-1', content: 'v1' },
        { id: 'b', namespace: 'ns-1', key: 'k-2', content: 'v2' },
        { id: 'c', namespace: 'ns-2', key: 'k-1', content: 'v3' },
      ]);
      const results = await asReadable(access).list<MemoryEntryShape>({ storeId: STORE_ID });
      expect(results.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('namespace filter keeps only matching entries', async () => {
      await seed([
        { id: 'a', namespace: 'ns-1', key: 'k-1', content: 'v1' },
        { id: 'b', namespace: 'ns-1', key: 'k-2', content: 'v2' },
        { id: 'c', namespace: 'ns-2', key: 'k-1', content: 'v3' },
      ]);
      const results = await asReadable(access).list<MemoryEntryShape>({
        storeId: STORE_ID,
        namespace: 'ns-1',
      });
      expect(results.map((r) => r.id).sort()).toEqual(['a', 'b']);
    });

    it('offset + limit page through the result set', async () => {
      // Createdat-ordered: a (1), b (2), c (3), d (4) — all in ns-1.
      await seed([
        { id: 'a', namespace: 'ns-1', key: 'k-1', content: 'v1', createdAt: 1 },
        { id: 'b', namespace: 'ns-1', key: 'k-2', content: 'v2', createdAt: 2 },
        { id: 'c', namespace: 'ns-1', key: 'k-3', content: 'v3', createdAt: 3 },
        { id: 'd', namespace: 'ns-1', key: 'k-4', content: 'v4', createdAt: 4 },
      ]);
      const results = await asReadable(access).list<MemoryEntryShape>({
        storeId: STORE_ID,
        namespace: 'ns-1',
        offset: 1,
        limit: 2,
      });
      expect(results.map((r) => r.id)).toEqual(['b', 'c']);
    });

    it('returns empty array when no entries match the namespace filter', async () => {
      await seed([{ id: 'a', namespace: 'ns-1', key: 'k-1', content: 'v1' }]);
      const results = await asReadable(access).list<MemoryEntryShape>({
        storeId: STORE_ID,
        namespace: 'ns-different',
      });
      expect(results).toEqual([]);
    });

    it('throws fail-loud when the backend lacks queryAsync (wiring gap)', async () => {
      const naked = makeRvfSubstrate(makeNonAdapterBackend());
      await expect(
        asReadable(naked).list({ storeId: STORE_ID, namespace: 'n', limit: 10 }),
      ).rejects.toThrow(/list is not available.*queryAsync.*MemoryRvfAdapter/s);
    });
  });
});
