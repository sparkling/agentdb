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
      expect(results[0]!.metadata).toEqual({ tag: 'alpha' });
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
      expect(results[0]!.metadata).toEqual({ source: 'phase4' });
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
});
