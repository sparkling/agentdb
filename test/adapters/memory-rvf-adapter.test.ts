// charter: adapter-seam
// ADR-0181 Phase 4 — MemoryRvfAdapter behavioral spec.
//
// Verifies the typed bridge from `@claude-flow/memory`'s `RvfBackend`
// (IMemoryBackend-shaped) to agentdb's `VectorBackendAsync`. The adapter is
// tested against a structural `IMemoryRvfBackend` stub (the production memory
// `RvfBackend` requires `@ruvector/rvf` and a real on-disk file — irrelevant
// to the bridge's contract). The cli's `RvfBackend` instance is substituted
// for this stub at runtime.

import { describe, it, expect } from 'vitest';

import {
  MemoryRvfAdapter,
  MemoryRvfAdapterFilterUnsupportedError,
  MemoryRvfAdapterSyncUnsupportedError,
  type IMemoryRvfBackend,
  type MemoryEntryShape,
  type MemorySearchOptionsShape,
  type MemorySearchResultShape,
  type MemoryBackendStatsShape,
} from '../../src/adapters/memory-rvf-adapter.js';

/**
 * Minimal in-memory `IMemoryRvfBackend` stub. Tracks stored entries by id,
 * serves searches by cosine similarity over stored embeddings, and surfaces
 * stats sufficient for the adapter's `getStatsAsync` downcast. Faithful to
 * the structural contract — no shortcuts that the production memory
 * `RvfBackend` does not itself honour.
 */
function makeStubBackend(dimension: number): IMemoryRvfBackend & {
  readonly entries: Map<string, MemoryEntryShape>;
} {
  const entries = new Map<string, MemoryEntryShape>();
  let storedDimension = 0;

  function cosine(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    let aNorm = 0;
    let bNorm = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      aNorm += a[i]! * a[i]!;
      bNorm += b[i]! * b[i]!;
    }
    const denom = Math.sqrt(aNorm) * Math.sqrt(bNorm);
    return denom === 0 ? 0 : dot / denom;
  }

  return {
    entries,
    async initialize(): Promise<void> {
      // no-op
    },
    async shutdown(): Promise<void> {
      entries.clear();
    },
    async store(entry: MemoryEntryShape): Promise<void> {
      entries.set(entry.id, entry);
      if (entry.embedding) storedDimension = entry.embedding.length;
    },
    async bulkInsert(items: readonly MemoryEntryShape[]): Promise<void> {
      for (const item of items) {
        entries.set(item.id, item);
        if (item.embedding) storedDimension = item.embedding.length;
      }
    },
    async search(
      embedding: Float32Array,
      options: MemorySearchOptionsShape,
    ): Promise<readonly MemorySearchResultShape[]> {
      const scored: MemorySearchResultShape[] = [];
      for (const entry of entries.values()) {
        if (!entry.embedding) continue;
        if (entry.embedding.length !== embedding.length) continue;
        const score = cosine(embedding, entry.embedding);
        if (options.threshold !== undefined && score < options.threshold) continue;
        scored.push({ entry, score, distance: 1 - score });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, options.k);
    },
    async delete(id: string): Promise<boolean> {
      return entries.delete(id);
    },
    async getStats(): Promise<MemoryBackendStatsShape> {
      return { totalEntries: entries.size, memoryUsage: entries.size * dimension * 4 };
    },
    async getStoredDimension(): Promise<number> {
      return storedDimension;
    },
    async getByKey(namespace: string, key: string): Promise<MemoryEntryShape | null> {
      for (const entry of entries.values()) {
        if (entry.namespace === namespace && entry.key === key) return entry;
      }
      return null;
    },
    async update(
      id: string,
      update: {
        readonly content?: string;
        readonly tags?: readonly string[];
        readonly metadata?: Record<string, unknown>;
        readonly embedding?: Float32Array;
      },
    ): Promise<MemoryEntryShape | null> {
      const existing = entries.get(id);
      if (!existing) return null;
      const updated: MemoryEntryShape = {
        ...existing,
        content: update.content ?? existing.content,
        tags: update.tags ?? existing.tags,
        metadata: update.metadata ?? existing.metadata,
        embedding: update.embedding ?? existing.embedding,
        updatedAt: Date.now(),
        version: existing.version + 1,
      };
      entries.set(id, updated);
      return updated;
    },
    // ADR-0181 task #99 commit 1 — vectorless scan over stored entries with
    // namespace / limit / offset filters. Mirrors `RvfBackend.query` (the
    // cli's filter pipeline minus the semantic-vector branch we don't need
    // here). Sorts by createdAt ascending so pagination is deterministic.
    async query(q: {
      readonly type: 'exact';
      readonly namespace?: string;
      readonly limit: number;
      readonly offset?: number;
    }): Promise<readonly MemoryEntryShape[]> {
      let rows = Array.from(entries.values());
      if (q.namespace !== undefined) {
        rows = rows.filter((e) => e.namespace === q.namespace);
      }
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

const DIM = 4;
function vec(...xs: number[]): Float32Array {
  if (xs.length !== DIM) throw new Error(`test vector length ${xs.length} ≠ DIM ${DIM}`);
  return Float32Array.from(xs);
}

describe('MemoryRvfAdapter — typed bridge from @claude-flow/memory RvfBackend → VectorBackendAsync', () => {
  describe('async round-trip (insertAsync + searchAsync)', () => {
    it('insertAsync followed by searchAsync returns the same id with similarity ≈ 1', async () => {
      const stub = makeStubBackend(DIM);
      const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });

      const id = 'v1';
      const embedding = vec(1, 0, 0, 0);
      await adapter.insertAsync(id, embedding, { tag: 'alpha' });

      const results = await adapter.searchAsync(embedding, 3);
      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe(id);
      expect(results[0]!.similarity).toBeCloseTo(1, 6);
      expect(results[0]!.distance).toBeCloseTo(0, 6);
      // ADR-0181 task #100 (cli-flip prep) — searchAsync MERGES top-level
      // entry fields (namespace/key/content/tags) into result.metadata so
      // dispatched read handlers see a uniform shape regardless of which
      // write path produced the entry. The caller-supplied `tag: 'alpha'`
      // is preserved (spread-at-end semantics); the synthesized top-level
      // fields appear alongside it.
      expect(results[0]!.metadata).toEqual({
        namespace: 'agentdb-vector', // adapter defaultNamespace
        key: id,
        content: '',
        tags: [],
        tag: 'alpha',
      });
    });

    it('searchAsync threshold prunes low-similarity matches', async () => {
      const stub = makeStubBackend(DIM);
      const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });

      await adapter.insertAsync('near', vec(1, 0, 0, 0));
      await adapter.insertAsync('far', vec(0, 1, 0, 0));

      const results = await adapter.searchAsync(vec(1, 0, 0, 0), 10, { threshold: 0.5 });
      expect(results.map((r) => r.id)).toEqual(['near']);
    });

    it('insertBatchAsync followed by searchAsync ranks by similarity', async () => {
      const stub = makeStubBackend(DIM);
      const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });

      await adapter.insertBatchAsync([
        { id: 'a', embedding: vec(1, 0, 0, 0) },
        { id: 'b', embedding: vec(0.5, 0.5, 0, 0) },
        { id: 'c', embedding: vec(0, 1, 0, 0) },
      ]);

      const results = await adapter.searchAsync(vec(1, 0, 0, 0), 3);
      expect(results.map((r) => r.id)).toEqual(['a', 'b', 'c']);
      expect(results[0]!.similarity).toBeGreaterThan(results[1]!.similarity);
      expect(results[1]!.similarity).toBeGreaterThan(results[2]!.similarity);
    });

    it('removeAsync deletes the entry and search no longer returns it', async () => {
      const stub = makeStubBackend(DIM);
      const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });

      await adapter.insertAsync('gone', vec(1, 0, 0, 0));
      const removed = await adapter.removeAsync('gone');
      expect(removed).toBe(true);

      const results = await adapter.searchAsync(vec(1, 0, 0, 0), 3);
      expect(results.length).toBe(0);
    });

    it('searchAsync returns metadata as a fresh object (substrate-semantic immutability)', async () => {
      const stub = makeStubBackend(DIM);
      const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });

      const meta = { source: 'phase4' };
      await adapter.insertAsync('m', vec(1, 0, 0, 0), meta);

      const results = await adapter.searchAsync(vec(1, 0, 0, 0), 1);
      // ADR-0181 task #100 (cli-flip prep) — merged metadata carries
      // namespace/key/content/tags alongside the caller-supplied `source`.
      // Identity (`not.toBe`) check still proves the substrate-semantic
      // immutability invariant — the adapter returns a fresh map, not the
      // caller's reference.
      expect(results[0]!.metadata).toEqual({
        namespace: 'agentdb-vector',
        key: 'm',
        content: '',
        tags: [],
        source: 'phase4',
      });
      expect(results[0]!.metadata).not.toBe(meta);
    });

    it('searchAsync rejects SearchOptions.filter fail-loud (no silent drop — DA-2)', async () => {
      const stub = makeStubBackend(DIM);
      const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });
      await adapter.insertAsync('x', vec(1, 0, 0, 0), { tag: 'phase4' });

      await expect(
        adapter.searchAsync(vec(1, 0, 0, 0), 3, { filter: { tag: 'phase4' } }),
      ).rejects.toBeInstanceOf(MemoryRvfAdapterFilterUnsupportedError);
    });

    it('searchAsync ignores an empty filter object (only non-empty fails loud)', async () => {
      const stub = makeStubBackend(DIM);
      const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });
      await adapter.insertAsync('x', vec(1, 0, 0, 0));

      await expect(adapter.searchAsync(vec(1, 0, 0, 0), 3, { filter: {} })).resolves.toBeDefined();
    });
  });

  describe('getStatsAsync — BackendStats → VectorStats downcast', () => {
    it('returns sensible numbers reflecting underlying memory state', async () => {
      const stub = makeStubBackend(DIM);
      const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });

      await adapter.insertAsync('a', vec(1, 0, 0, 0));
      await adapter.insertAsync('b', vec(0, 1, 0, 0));

      const stats = await adapter.getStatsAsync();
      expect(stats.count).toBe(2);
      expect(stats.dimension).toBe(DIM);
      expect(stats.metric).toBe('cosine');
      expect(stats.backend).toBe('rvf');
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });

    it('falls back to the dimensionHint when getStoredDimension() returns 0 (empty store)', async () => {
      const stub = makeStubBackend(DIM);
      const adapter = new MemoryRvfAdapter(stub, { dimension: 768 });

      const stats = await adapter.getStatsAsync();
      expect(stats.count).toBe(0);
      expect(stats.dimension).toBe(768);
    });

    it('honours a configured metric override', async () => {
      const stub = makeStubBackend(DIM);
      const adapter = new MemoryRvfAdapter(stub, { dimension: DIM, metric: 'l2' });

      const stats = await adapter.getStatsAsync();
      expect(stats.metric).toBe('l2');
    });
  });

  describe('flush() — eager-WAL no-op', () => {
    it('resolves without invoking any underlying method', async () => {
      let touched = false;
      const baseline = makeStubBackend(DIM);
      const tracked: IMemoryRvfBackend = {
        initialize: () => {
          touched = true;
          return baseline.initialize();
        },
        shutdown: () => {
          touched = true;
          return baseline.shutdown();
        },
        store: (e) => {
          touched = true;
          return baseline.store(e);
        },
        bulkInsert: (es) => {
          touched = true;
          return baseline.bulkInsert(es);
        },
        search: (e, o) => {
          touched = true;
          return baseline.search(e, o);
        },
        delete: (id) => {
          touched = true;
          return baseline.delete(id);
        },
        getStats: () => {
          touched = true;
          return baseline.getStats();
        },
        getStoredDimension: () => {
          touched = true;
          return baseline.getStoredDimension();
        },
        getByKey: (ns, key) => {
          touched = true;
          return baseline.getByKey(ns, key);
        },
        update: (id, u) => {
          touched = true;
          return baseline.update(id, u);
        },
        query: (q) => {
          touched = true;
          return baseline.query(q);
        },
        listNamespaces: () => {
          touched = true;
          return baseline.listNamespaces();
        },
      };

      const adapter = new MemoryRvfAdapter(tracked, { dimension: DIM });
      await expect(adapter.flush()).resolves.toBeUndefined();
      expect(touched).toBe(false);
    });
  });

  describe('sync VectorBackend methods — fail loud (memory is async-only)', () => {
    it('insert() throws MemoryRvfAdapterSyncUnsupportedError', () => {
      const adapter = new MemoryRvfAdapter(makeStubBackend(DIM), { dimension: DIM });
      expect(() => adapter.insert('x', vec(1, 0, 0, 0))).toThrow(
        MemoryRvfAdapterSyncUnsupportedError,
      );
    });

    it('insertBatch() throws MemoryRvfAdapterSyncUnsupportedError', () => {
      const adapter = new MemoryRvfAdapter(makeStubBackend(DIM), { dimension: DIM });
      expect(() => adapter.insertBatch([{ id: 'x', embedding: vec(1, 0, 0, 0) }])).toThrow(
        MemoryRvfAdapterSyncUnsupportedError,
      );
    });

    it('search() throws MemoryRvfAdapterSyncUnsupportedError', () => {
      const adapter = new MemoryRvfAdapter(makeStubBackend(DIM), { dimension: DIM });
      expect(() => adapter.search(vec(1, 0, 0, 0), 3)).toThrow(
        MemoryRvfAdapterSyncUnsupportedError,
      );
    });

    it('remove() throws MemoryRvfAdapterSyncUnsupportedError', () => {
      const adapter = new MemoryRvfAdapter(makeStubBackend(DIM), { dimension: DIM });
      expect(() => adapter.remove('x')).toThrow(MemoryRvfAdapterSyncUnsupportedError);
    });

    it('getStats() (sync) throws MemoryRvfAdapterSyncUnsupportedError', () => {
      const adapter = new MemoryRvfAdapter(makeStubBackend(DIM), { dimension: DIM });
      expect(() => adapter.getStats()).toThrow(MemoryRvfAdapterSyncUnsupportedError);
    });

    it('close() throws MemoryRvfAdapterSyncUnsupportedError (use memory.shutdown() directly)', () => {
      const adapter = new MemoryRvfAdapter(makeStubBackend(DIM), { dimension: DIM });
      expect(() => adapter.close()).toThrow(MemoryRvfAdapterSyncUnsupportedError);
    });
  });

  describe('save() / load() — eager-WAL no-ops', () => {
    it('save() resolves without touching the backend', async () => {
      const stub = makeStubBackend(DIM);
      const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });
      await expect(adapter.save('/tmp/should-not-be-touched')).resolves.toBeUndefined();
    });

    it('load() resolves without touching the backend', async () => {
      const stub = makeStubBackend(DIM);
      const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });
      await expect(adapter.load('/tmp/should-not-be-touched')).resolves.toBeUndefined();
    });
  });

  describe('metadata namespace + key resolution', () => {
    it('insertAsync honours metadata.namespace when supplied', async () => {
      const stub = makeStubBackend(DIM);
      const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });
      await adapter.insertAsync('id1', vec(1, 0, 0, 0), { namespace: 'custom-ns' });
      const stored = stub.entries.get('id1')!;
      expect(stored.namespace).toBe('custom-ns');
    });

    it('insertAsync falls back to defaultNamespace when metadata omits namespace', async () => {
      const stub = makeStubBackend(DIM);
      const adapter = new MemoryRvfAdapter(stub, { dimension: DIM, defaultNamespace: 'my-default' });
      await adapter.insertAsync('id2', vec(1, 0, 0, 0));
      const stored = stub.entries.get('id2')!;
      expect(stored.namespace).toBe('my-default');
    });

    it('insertAsync uses id as key when metadata.key is omitted', async () => {
      const stub = makeStubBackend(DIM);
      const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });
      await adapter.insertAsync('id3', vec(1, 0, 0, 0));
      expect(stub.entries.get('id3')!.key).toBe('id3');
    });

    it('insertAsync honours metadata.key when supplied', async () => {
      const stub = makeStubBackend(DIM);
      const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });
      await adapter.insertAsync('id4', vec(1, 0, 0, 0), { key: 'custom-key' });
      expect(stub.entries.get('id4')!.key).toBe('custom-key');
    });
  });

  // ─── ADR-0181 task #100 (cli-flip prep) — top-level→metadata merge ───
  //
  // Production sees two write paths into the same memory backend:
  //   1. archivist.dispatch('memory_store') writes rich metadata that
  //      already carries {namespace, key, content, tags, ...}.
  //   2. routeMemoryOp({type:'store'}) writes EMPTY metadata; the
  //      namespace/key/content/tags live ONLY on the top-level MemoryEntry.
  // Read handlers project off result.metadata, so the adapter MERGES top-
  // level entry fields into the result/entry metadata so dispatched read
  // handlers see a uniform shape across both write paths.
  //
  // Spread-at-end semantics: dispatch-written entries (rich metadata)
  // keep their explicit values verbatim; routeMemoryOp-written entries
  // (empty metadata) get the top-level fields filled in. These tests
  // simulate both write paths by seeding the backend directly with the
  // two shapes and verifying each read method surfaces the merge.
  describe('top-level → metadata merge (cli-flip prep, ADR-0181 task #100)', () => {
    function seedEntry(
      stub: ReturnType<typeof makeStubBackend>,
      opts: {
        id: string;
        embedding: Float32Array;
        namespace: string;
        key: string;
        content: string;
        tags: readonly string[];
        metadata: Record<string, unknown>;
      },
    ): void {
      const now = Date.now();
      stub.entries.set(opts.id, {
        id: opts.id,
        key: opts.key,
        content: opts.content,
        embedding: opts.embedding,
        type: 'semantic',
        namespace: opts.namespace,
        tags: opts.tags,
        metadata: opts.metadata,
        accessLevel: 'private',
        createdAt: now,
        updatedAt: now,
        version: 1,
        references: [],
        accessCount: 0,
        lastAccessedAt: now,
      });
    }

    describe('searchAsync', () => {
      it('fills in top-level fields when entry.metadata is empty (routeMemoryOp-store shape)', async () => {
        const stub = makeStubBackend(DIM);
        const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });
        seedEntry(stub, {
          id: 'route:k1',
          embedding: vec(1, 0, 0, 0),
          namespace: 'route-ns',
          key: 'k1',
          content: 'hello',
          tags: ['t1', 't2'],
          metadata: {}, // empty — routeMemoryOp-store write path
        });

        const results = await adapter.searchAsync(vec(1, 0, 0, 0), 1);
        expect(results).toHaveLength(1);
        expect(results[0]!.metadata).toEqual({
          namespace: 'route-ns',
          key: 'k1',
          content: 'hello',
          tags: ['t1', 't2'],
        });
      });

      it('preserves explicit metadata values when both shapes overlap (dispatch-store shape)', async () => {
        const stub = makeStubBackend(DIM);
        const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });
        // Dispatch-store path: top-level AND metadata both carry the
        // canonical values. Spread-at-end means the metadata spread
        // overwrites the synthesized top-level defaults — explicit values
        // win, no regression.
        seedEntry(stub, {
          id: 'disp:k1',
          embedding: vec(1, 0, 0, 0),
          namespace: 'disp-ns',
          key: 'k1',
          content: 'top-level-content',
          tags: ['top-tag'],
          metadata: {
            namespace: 'disp-ns',
            key: 'k1',
            content: 'metadata-content',
            tags: ['md-tag'],
            extra: 'kept',
          },
        });

        const results = await adapter.searchAsync(vec(1, 0, 0, 0), 1);
        expect(results[0]!.metadata).toEqual({
          namespace: 'disp-ns',
          key: 'k1',
          content: 'metadata-content', // explicit metadata wins
          tags: ['md-tag'], // explicit metadata wins
          extra: 'kept',
        });
      });
    });

    describe('getByKeyAsync', () => {
      it('surfaces merged metadata while preserving top-level entry fields', async () => {
        const stub = makeStubBackend(DIM);
        const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });
        seedEntry(stub, {
          id: 'route:k1',
          embedding: vec(1, 0, 0, 0),
          namespace: 'route-ns',
          key: 'k1',
          content: 'hello',
          tags: ['t1'],
          metadata: {}, // routeMemoryOp-store shape
        });

        const entry = await adapter.getByKeyAsync('route-ns', 'k1');
        expect(entry).not.toBeNull();
        // Top-level fields preserved as first-class properties.
        expect(entry!.namespace).toBe('route-ns');
        expect(entry!.key).toBe('k1');
        expect(entry!.content).toBe('hello');
        expect(entry!.tags).toEqual(['t1']);
        // Metadata field carries the merged shape.
        expect(entry!.metadata).toEqual({
          namespace: 'route-ns',
          key: 'k1',
          content: 'hello',
          tags: ['t1'],
        });
      });

      it('returns null on miss (no merge attempted on null)', async () => {
        const stub = makeStubBackend(DIM);
        const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });
        const entry = await adapter.getByKeyAsync('any', 'missing');
        expect(entry).toBeNull();
      });
    });

    describe('queryAsync', () => {
      it('surfaces merged metadata on every row (mixed write paths)', async () => {
        const stub = makeStubBackend(DIM);
        const adapter = new MemoryRvfAdapter(stub, { dimension: DIM });
        seedEntry(stub, {
          id: 'route:1',
          embedding: vec(1, 0, 0, 0),
          namespace: 'shared-ns',
          key: 'k1',
          content: 'route-content',
          tags: ['rt'],
          metadata: {}, // routeMemoryOp-store
        });
        seedEntry(stub, {
          id: 'disp:1',
          embedding: vec(0, 1, 0, 0),
          namespace: 'shared-ns',
          key: 'k2',
          content: 'top-level',
          tags: ['top'],
          metadata: {
            namespace: 'shared-ns',
            key: 'k2',
            content: 'md-content',
            tags: ['md'],
          }, // dispatch-store
        });

        const rows = await adapter.queryAsync({ namespace: 'shared-ns', limit: 10 });
        expect(rows).toHaveLength(2);

        const k1 = rows.find((r) => r.key === 'k1');
        expect(k1).toBeDefined();
        expect(k1!.metadata).toEqual({
          namespace: 'shared-ns',
          key: 'k1',
          content: 'route-content',
          tags: ['rt'],
        });

        const k2 = rows.find((r) => r.key === 'k2');
        expect(k2).toBeDefined();
        expect(k2!.metadata).toEqual({
          namespace: 'shared-ns',
          key: 'k2',
          content: 'md-content', // explicit metadata wins
          tags: ['md'], // explicit metadata wins
        });
      });
    });
  });
});
