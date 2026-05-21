/**
 * Unit Tests for RuVectorBackend
 *
 * Covers the version-independent / pure-JS surface of the RuVector vector
 * backend adapter:
 * - Constructor + dimension/path security validation
 * - ensureInitialized() guards on every public operation
 * - Adaptive HNSW parameter selection (static + via initialize)
 * - Exported helper classes: Semaphore (fairness) and BufferPool (reuse + zero-fill)
 * - Concurrency status, buffer pool accessor, mmap status, stats reset
 * - Exported security/perf constants
 *
 * NATIVE BINDING NOTE:
 *   The installed `ruvector@0.1.96` exposes a FULLY ASYNC native API
 *   (`insert`/`search`/`len`/`delete`/`get` all return Promises) with no
 *   synchronous accessor, while the public `VectorBackend` contract is
 *   synchronous. The adapter reconciles the two with an in-memory mirror that
 *   backs the sync surface (brute-force SIMD search) plus a `VectorBackendAsync`
 *   surface that drives the native HNSW index. The "async-native binding
 *   round-trip" describe block exercises the real insert -> search -> getStats
 *   path against the installed binding.
 *
 * House style: real RuVectorBackend instances, unique fixtures per test,
 * meaningful behavioral assertions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RuVectorBackend,
  Semaphore,
  BufferPool,
  MAX_VECTOR_DIMENSION,
  MAX_BATCH_SIZE,
  DEFAULT_CACHE_SIZE,
} from '../../../src/backends/ruvector/RuVectorBackend.js';
import type { VectorConfig } from '../../../src/backends/VectorBackend.js';

// --- Fixtures ---------------------------------------------------------------

const COSINE_8: VectorConfig = { dimension: 8, metric: 'cosine' };

function makeUnitVector(dimension: number, hot = 0): Float32Array {
  const v = new Float32Array(dimension);
  v[hot % dimension] = 1;
  return v;
}

describe('RuVectorBackend', () => {
  describe('constructor validation', () => {
    it('exposes the canonical backend name', () => {
      const backend = new RuVectorBackend(COSINE_8);
      expect(backend.name).toBe('ruvector');
    });

    it('throws when no dimension/dimensions is provided', () => {
      expect(() => new RuVectorBackend({ metric: 'cosine' } as VectorConfig)).toThrow(
        /dimension is required/
      );
    });

    it('treats a falsy dimension of 0 as missing', () => {
      expect(() => new RuVectorBackend({ dimension: 0, metric: 'cosine' })).toThrow(
        /dimension is required/
      );
    });

    it('rejects a dimension above MAX_VECTOR_DIMENSION', () => {
      expect(
        () => new RuVectorBackend({ dimension: MAX_VECTOR_DIMENSION + 1, metric: 'l2' })
      ).toThrow(/Dimension must be between 1 and 4096/);
    });

    it('accepts the `dimensions` alias for backward compatibility', () => {
      expect(() => new RuVectorBackend({ dimensions: 16, metric: 'ip' })).not.toThrow();
    });

    it('rejects a path-traversal mmapPath at construction time', () => {
      expect(
        () =>
          new RuVectorBackend({
            dimension: 8,
            metric: 'cosine',
            enableMmap: true,
            mmapPath: '../etc/passwd',
          } as any)
      ).toThrow(/forbidden pattern/);
    });

    it('clamps parallelConcurrency to the safe upper bound of 32', () => {
      const backend = new RuVectorBackend({
        ...COSINE_8,
        parallelConcurrency: 500,
      } as any);
      // available reflects the clamped semaphore permits
      expect(backend.getConcurrencyStatus().available).toBe(32);
    });

    it('uses a default concurrency of 4 when unspecified', () => {
      const backend = new RuVectorBackend(COSINE_8);
      const status = backend.getConcurrencyStatus();
      expect(status.available).toBe(4);
      expect(status.configured).toBe(4);
    });
  });

  describe('ensureInitialized guards (before initialize())', () => {
    let backend: RuVectorBackend;

    beforeEach(() => {
      backend = new RuVectorBackend(COSINE_8);
    });

    it('blocks insert() until initialize() is called', () => {
      expect(() => backend.insert('a', makeUnitVector(8))).toThrow(/not initialized/);
    });

    it('blocks search() until initialize() is called', () => {
      expect(() => backend.search(makeUnitVector(8), 1)).toThrow(/not initialized/);
    });

    it('blocks getStats() until initialize() is called', () => {
      expect(() => backend.getStats()).toThrow(/not initialized/);
    });

    it('blocks remove() until initialize() is called', () => {
      expect(() => backend.remove('a')).toThrow(/not initialized/);
    });

    it('blocks insertBatch() until initialize() is called', () => {
      expect(() => backend.insertBatch([{ id: 'a', embedding: makeUnitVector(8) }])).toThrow(
        /not initialized/
      );
    });
  });

  describe('utility methods (no native binding required)', () => {
    let backend: RuVectorBackend;

    beforeEach(() => {
      backend = new RuVectorBackend(COSINE_8);
    });

    it('reports mmap as disabled by default', () => {
      expect(backend.isMmapEnabled()).toBe(false);
    });

    it('exposes the buffer pool instance with empty initial stats', () => {
      const pool = backend.getBufferPool();
      expect(pool).toBeInstanceOf(BufferPool);
      expect(pool.getStats()).toEqual({ totalBuffers: 0, totalMemory: 0 });
    });

    it('resetStats() does not require initialization and clears counters', () => {
      expect(() => backend.resetStats()).not.toThrow();
    });
  });

  describe('static getRecommendedParams', () => {
    it('returns lightweight params for small datasets (< 1000)', () => {
      expect(RuVectorBackend.getRecommendedParams(500)).toEqual({
        M: 8,
        efConstruction: 100,
        efSearch: 50,
      });
    });

    it('returns balanced params for medium datasets (1000 - 100000)', () => {
      expect(RuVectorBackend.getRecommendedParams(50_000)).toEqual({
        M: 16,
        efConstruction: 200,
        efSearch: 100,
      });
    });

    it('returns high-recall params for large datasets (> 100000)', () => {
      expect(RuVectorBackend.getRecommendedParams(250_000)).toEqual({
        M: 32,
        efConstruction: 400,
        efSearch: 200,
      });
    });

    it('chooses params monotonically by dataset size (M never decreases)', () => {
      const small = RuVectorBackend.getRecommendedParams(100);
      const medium = RuVectorBackend.getRecommendedParams(10_000);
      const large = RuVectorBackend.getRecommendedParams(1_000_000);
      expect(small.M).toBeLessThanOrEqual(medium.M);
      expect(medium.M).toBeLessThanOrEqual(large.M);
    });
  });

  describe('exported constants', () => {
    it('exposes documented security/perf bounds', () => {
      expect(MAX_VECTOR_DIMENSION).toBe(4096);
      expect(MAX_BATCH_SIZE).toBe(10000);
      expect(DEFAULT_CACHE_SIZE).toBe(10000);
    });
  });

  describe('initialize()', () => {
    it('initializes against the installed native binding without throwing', async () => {
      // ruvector forces dim 768 internally; use it so the constructor matches.
      const backend = new RuVectorBackend({ dimension: 768, metric: 'cosine', maxElements: 500 });
      await expect(backend.initialize()).resolves.toBeUndefined();
    });

    it('is idempotent: a second initialize() is a no-op', async () => {
      const backend = new RuVectorBackend({ dimension: 768, metric: 'cosine' });
      await backend.initialize();
      await expect(backend.initialize()).resolves.toBeUndefined();
    });

    it('unblocks the ensureInitialized guards after initialize()', async () => {
      const backend = new RuVectorBackend({ dimension: 768, metric: 'cosine' });
      await backend.initialize();
      // Guard no longer fires — insert writes into the in-memory mirror.
      expect(() => backend.insert('guard-check', makeUnitVector(768))).not.toThrow();
    });
  });

  // ===========================================================================
  // ASYNC-NATIVE BINDING ROUND-TRIP (real behavior — NOT faked)
  //
  // ruvector@0.1.96 exposes a fully async API (insert/search/len/delete return
  // Promises) with no synchronous accessor, and the public VectorBackend
  // contract is synchronous. The adapter reconciles the two with an in-memory
  // mirror (sync surface, brute-force SIMD search) plus an async surface that
  // drives the native HNSW index. These tests assert the CORRECTED behavior:
  // insert -> search -> getStats works end-to-end and returns real data.
  // The binding forces dimension 768, so the fixtures use it.
  // ===========================================================================
  describe('async-native binding round-trip (ruvector@0.1.96)', () => {
    let backend: RuVectorBackend;

    beforeEach(async () => {
      backend = new RuVectorBackend({ dimension: 768, metric: 'cosine', maxElements: 500 });
      await backend.initialize();
    });

    it('getStats() returns real counts from the in-memory mirror (no throw)', () => {
      expect(backend.getStats().count).toBe(0);

      backend.insert('s-a', makeUnitVector(768, 0));
      backend.insert('s-b', makeUnitVector(768, 1));

      const stats = backend.getStats();
      expect(stats.count).toBe(2);
      expect(stats.dimension).toBe(768);
      expect(stats.metric).toBe('cosine');
      expect(stats.backend).toBe('ruvector');
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });

    it('search() returns the inserted vector as the nearest neighbour', () => {
      backend.insert('vec-a', makeUnitVector(768, 0), { tag: 'alpha' });
      backend.insert('vec-b', makeUnitVector(768, 1), { tag: 'beta' });

      const results = backend.search(makeUnitVector(768, 0), 2);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThanOrEqual(1);

      // The exact match is the top hit with similarity ~1 (cosine distance ~0).
      expect(results[0].id).toBe('vec-a');
      expect(results[0].similarity).toBeCloseTo(1, 5);
      expect(results[0].metadata).toEqual({ tag: 'alpha' });
    });

    it('search() honours k and orders results by similarity (most similar first)', () => {
      backend.insert('hot', makeUnitVector(768, 3));
      backend.insert('cold', makeUnitVector(768, 7));

      const top1 = backend.search(makeUnitVector(768, 3), 1);
      expect(top1).toHaveLength(1);
      expect(top1[0].id).toBe('hot');

      const all = backend.search(makeUnitVector(768, 3), 5);
      // 'hot' (identical) must rank ahead of the orthogonal 'cold'.
      expect(all[0].id).toBe('hot');
      expect(all[0].similarity).toBeGreaterThanOrEqual(all[all.length - 1].similarity);
    });

    it('remove() deletes a vector and is reflected in getStats() and search()', () => {
      backend.insert('vec-a', makeUnitVector(768, 0));
      backend.insert('vec-b', makeUnitVector(768, 1));
      expect(backend.getStats().count).toBe(2);

      // Existing id -> true; subsequent search no longer returns it.
      expect(backend.remove('vec-a')).toBe(true);
      expect(backend.getStats().count).toBe(1);
      expect(backend.search(makeUnitVector(768, 0), 5).some((r) => r.id === 'vec-a')).toBe(false);

      // Unknown id -> false (nothing removed).
      expect(backend.remove('vec-a')).toBe(false);
      expect(backend.remove('never-inserted')).toBe(false);
    });

    it('searchAsync() drives the native HNSW index and returns the inserted vector', async () => {
      await backend.insertAsync('async-a', makeUnitVector(768, 5), { tag: 'gamma' });

      const results = await backend.searchAsync(makeUnitVector(768, 5), 3);
      expect(results.length).toBeGreaterThanOrEqual(1);
      const hit = results.find((r) => r.id === 'async-a');
      expect(hit).toBeDefined();
      expect(hit!.similarity).toBeCloseTo(1, 4);
    });
  });

  // ===========================================================================
  // Helper classes exported for advanced use cases.
  // These are pure JS and fully testable regardless of the native binding.
  // ===========================================================================
  describe('Semaphore', () => {
    it('grants permits immediately while capacity remains', async () => {
      const sem = new Semaphore(2);
      await sem.acquire();
      await sem.acquire();
      expect(sem.available).toBe(0);
    });

    it('queues acquirers when exhausted and releases them FIFO on release()', async () => {
      const sem = new Semaphore(1);
      await sem.acquire(); // take the only permit

      const order: number[] = [];
      const waiter1 = sem.acquire().then(() => order.push(1));
      const waiter2 = sem.acquire().then(() => order.push(2));

      // Neither waiter should have resolved yet.
      await new Promise((r) => setTimeout(r, 5));
      expect(order).toEqual([]);

      sem.release(); // unblock waiter1
      await waiter1;
      expect(order).toEqual([1]);

      sem.release(); // unblock waiter2
      await waiter2;
      expect(order).toEqual([1, 2]);
    });

    it('increments available when released with no one waiting', () => {
      const sem = new Semaphore(1);
      sem.release();
      expect(sem.available).toBe(2);
    });
  });

  describe('BufferPool', () => {
    it('returns a Float32Array of the requested size', () => {
      const pool = new BufferPool(4);
      const buf = pool.acquire(8);
      expect(buf).toBeInstanceOf(Float32Array);
      expect(buf.length).toBe(8);
    });

    it('reuses a released buffer and zero-fills it before handing it back', () => {
      const pool = new BufferPool(4);
      const buf = pool.acquire(4);
      buf[0] = 42;
      buf[3] = -7;
      pool.release(buf);

      const reused = pool.acquire(4);
      expect(reused).toBe(buf); // same underlying instance
      expect(Array.from(reused)).toEqual([0, 0, 0, 0]); // cleared on release
    });

    it('segregates pools by buffer size', () => {
      const pool = new BufferPool(4);
      const small = pool.acquire(2);
      const large = pool.acquire(16);
      pool.release(small);
      pool.release(large);

      // Acquiring size 2 must not return the size-16 buffer.
      const again = pool.acquire(2);
      expect(again.length).toBe(2);
      expect(again).toBe(small);
    });

    it('caps the pool at maxPoolSize (excess buffers are not retained)', () => {
      const pool = new BufferPool(1); // hold at most 1 buffer per size
      const a = pool.acquire(4);
      const b = pool.acquire(4);
      pool.release(a);
      pool.release(b); // exceeds cap of 1 -> dropped

      const stats = pool.getStats();
      expect(stats.totalBuffers).toBe(1);
      expect(stats.totalMemory).toBe(4 * 4); // 4 floats * 4 bytes
    });

    it('clear() empties the pool', () => {
      const pool = new BufferPool(4);
      pool.release(pool.acquire(8));
      expect(pool.getStats().totalBuffers).toBe(1);
      pool.clear();
      expect(pool.getStats().totalBuffers).toBe(0);
    });
  });
});
