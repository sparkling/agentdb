/**
 * AdaptiveIndexTuner Tests - TemporalCompressor + IndexHealthMonitor
 *
 * Tests Phase 2 of ADR-005: Self-Learning Pipeline Integration
 * - Tiered vector compression (none/half/pq8/pq4/binary)
 * - Compression/decompression accuracy
 * - Access-frequency-based tier selection
 * - Index health monitoring and recommendations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TemporalCompressor,
  IndexHealthMonitor,
  type CompressionTier,
} from '../../src/backends/rvf/AdaptiveIndexTuner.js';
import type { IndexStats } from '../../src/backends/rvf/RvfBackend.js';

function generateVector(dim: number, seed: number = 42): Float32Array {
  const vec = new Float32Array(dim);
  let s = seed;
  for (let i = 0; i < dim; i++) {
    // Simple PRNG for reproducibility
    s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
    vec[i] = ((s >>> 0) / 0xFFFFFFFF) * 2 - 1;
  }
  return vec;
}

function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return 1 - sim;
}

describe('TemporalCompressor', () => {
  let compressor: TemporalCompressor;

  beforeEach(async () => {
    compressor = await TemporalCompressor.create();
  });

  describe('creation', () => {
    it('should create successfully', async () => {
      const c = await TemporalCompressor.create();
      expect(c).toBeDefined();
      expect(c.size).toBe(0);
      expect(c.isDestroyed).toBe(false);
    });

    it('should report availability', async () => {
      expect(await TemporalCompressor.isAvailable()).toBe(true);
    });
  });

  describe('tier selection', () => {
    it('should select "none" for hot data (freq >= 0.8)', () => {
      const vec = generateVector(128);
      const entry = compressor.compress('hot', vec, 0.95);
      expect(entry.tier).toBe('none');
    });

    it('should select "half" for warm data (freq >= 0.6)', () => {
      const vec = generateVector(128);
      const entry = compressor.compress('warm', vec, 0.7);
      expect(entry.tier).toBe('half');
    });

    it('should select "pq8" for cool data (freq >= 0.4)', () => {
      const vec = generateVector(128);
      const entry = compressor.compress('cool', vec, 0.5);
      expect(entry.tier).toBe('pq8');
    });

    it('should select "pq4" for cold data (freq >= 0.2)', () => {
      const vec = generateVector(128);
      const entry = compressor.compress('cold', vec, 0.3);
      expect(entry.tier).toBe('pq4');
    });

    it('should select "binary" for frozen data (freq < 0.2)', () => {
      const vec = generateVector(128);
      const entry = compressor.compress('frozen', vec, 0.1);
      expect(entry.tier).toBe('binary');
    });

    it('should clamp frequency to [0, 1]', () => {
      const vec = generateVector(128);
      const over = compressor.compress('over', vec, 1.5);
      expect(over.tier).toBe('none');
      expect(over.accessFrequency).toBe(1);

      const under = compressor.compress('under', vec, -0.5);
      expect(under.tier).toBe('binary');
      expect(under.accessFrequency).toBe(0);
    });
  });

  describe('compress/decompress accuracy', () => {
    const dim = 128;
    const tiers: Array<{ tier: CompressionTier; freq: number; maxError: number }> = [
      { tier: 'none', freq: 0.9, maxError: 0 },
      { tier: 'half', freq: 0.7, maxError: 0.001 },
      { tier: 'pq8', freq: 0.5, maxError: 0.01 },
      { tier: 'pq4', freq: 0.3, maxError: 0.1 },
      { tier: 'binary', freq: 0.1, maxError: 1.0 },
    ];

    for (const { tier, freq, maxError } of tiers) {
      it(`should round-trip "${tier}" tier within error tolerance`, () => {
        const original = generateVector(dim);
        compressor.compress(`test-${tier}`, original, freq);
        const restored = compressor.decompress(`test-${tier}`);

        expect(restored).not.toBeNull();
        expect(restored!.length).toBe(dim);

        if (tier === 'none') {
          // Lossless for 'none' tier
          for (let i = 0; i < dim; i++) {
            expect(restored![i]).toBeCloseTo(original[i], 5);
          }
        } else {
          // Lossy tiers: check cosine distance is within tolerance
          const dist = cosineDistance(original, restored!);
          expect(dist).toBeLessThan(maxError);
        }
      });
    }

    it('should preserve vector dimension across all tiers', () => {
      const dims = [32, 64, 128, 256, 512];
      for (const d of dims) {
        const vec = generateVector(d);
        compressor.compress(`dim-${d}`, vec, 0.5);
        const restored = compressor.decompress(`dim-${d}`);
        expect(restored!.length).toBe(d);
      }
    });

    it('should handle odd-length vectors in pq4 tier', () => {
      // pq4 packs two values per byte, so odd lengths need special handling
      const vec = generateVector(127); // odd
      compressor.compress('odd', vec, 0.3); // pq4 tier
      const restored = compressor.decompress('odd');
      expect(restored!.length).toBe(127);
    });
  });

  describe('decompressRaw', () => {
    it('should decompress from raw JSON without stored entry', () => {
      const vec = generateVector(64);
      const entry = compressor.compress('raw-test', vec, 0.5);
      const restored = compressor.decompressRaw(entry.compressedJson, entry.tier, entry.originalDim);
      expect(restored.length).toBe(64);
    });
  });

  describe('updateFrequency', () => {
    it('should recompress when tier changes', () => {
      const vec = generateVector(128);
      compressor.compress('update-test', vec, 0.9); // none tier

      const newTier = compressor.updateFrequency('update-test', 0.3); // should change to pq4
      expect(newTier).toBe('pq4');
    });

    it('should return same tier if unchanged', () => {
      const vec = generateVector(128);
      compressor.compress('same-tier', vec, 0.9); // none tier

      const newTier = compressor.updateFrequency('same-tier', 0.85); // still none
      expect(newTier).toBe('none');
    });

    it('should return null for unknown id', () => {
      expect(compressor.updateFrequency('nonexistent', 0.5)).toBeNull();
    });
  });

  describe('statistics', () => {
    it('should track entries by tier', () => {
      const vec = generateVector(64);
      compressor.compress('hot1', vec, 0.9);
      compressor.compress('hot2', vec, 0.85);
      compressor.compress('warm1', vec, 0.7);
      compressor.compress('cold1', vec, 0.3);
      compressor.compress('frozen1', vec, 0.05);

      const stats = compressor.getStats();
      expect(stats.totalEntries).toBe(5);
      expect(stats.byTier.none).toBe(2);
      expect(stats.byTier.half).toBe(1);
      expect(stats.byTier.pq4).toBe(1);
      expect(stats.byTier.binary).toBe(1);
      expect(stats.estimatedSavingsPercent).toBeGreaterThan(0);
    });

    it('should return 0 savings when empty', () => {
      const stats = compressor.getStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.estimatedSavingsPercent).toBe(0);
    });
  });

  describe('entry management', () => {
    it('should track entries with has()', () => {
      const vec = generateVector(64);
      expect(compressor.has('test')).toBe(false);
      compressor.compress('test', vec, 0.5);
      expect(compressor.has('test')).toBe(true);
    });

    it('should remove entries', () => {
      const vec = generateVector(64);
      compressor.compress('removable', vec, 0.5);
      expect(compressor.remove('removable')).toBe(true);
      expect(compressor.has('removable')).toBe(false);
      expect(compressor.remove('removable')).toBe(false);
    });

    it('should return null for unknown decompress', () => {
      expect(compressor.decompress('nonexistent')).toBeNull();
    });
  });

  describe('lifecycle', () => {
    it('should throw after destroy', () => {
      compressor.destroy();
      expect(compressor.isDestroyed).toBe(true);
      expect(() => compressor.compress('x', generateVector(64), 0.5)).toThrow('destroyed');
      expect(() => compressor.decompress('x')).toThrow('destroyed');
    });

    it('should be safe to destroy twice', () => {
      compressor.destroy();
      compressor.destroy(); // no-op
      expect(compressor.isDestroyed).toBe(true);
    });
  });
});

describe('IndexHealthMonitor', () => {
  let monitor: IndexHealthMonitor;

  const healthyStats: IndexStats = {
    indexedVectors: 5000,
    layers: 3,
    m: 16,
    efConstruction: 200,
    needsRebuild: false,
  };

  beforeEach(() => {
    monitor = new IndexHealthMonitor();
  });

  describe('assessment', () => {
    it('should report healthy for good stats with fast latencies', () => {
      // Record some fast latencies
      for (let i = 0; i < 10; i++) {
        monitor.recordSearch(2);
        monitor.recordInsert(1);
      }

      const health = monitor.assess(healthyStats);
      expect(health.healthy).toBe(true);
      expect(health.recommendations).toHaveLength(0);
      expect(health.indexedVectors).toBe(5000);
      expect(health.layers).toBe(3);
    });

    it('should flag needsRebuild', () => {
      const stats = { ...healthyStats, needsRebuild: true };
      const health = monitor.assess(stats);
      expect(health.healthy).toBe(false);
      expect(health.needsRebuild).toBe(true);
      expect(health.recommendations.some((r) => r.includes('rebuild'))).toBe(true);
    });

    it('should flag high search latency', () => {
      for (let i = 0; i < 10; i++) {
        monitor.recordSearch(100); // 100ms average
      }
      const health = monitor.assess(healthyStats);
      expect(health.avgSearchMs).toBe(100);
      expect(health.recommendations.some((r) => r.toLowerCase().includes('search latency'))).toBe(true);
    });

    it('should flag 0 layers with vectors', () => {
      const stats = { ...healthyStats, layers: 0 };
      const health = monitor.assess(stats);
      expect(health.healthy).toBe(false);
      expect(health.recommendations.some((r) => r.includes('0 layers'))).toBe(true);
    });

    it('should flag low M for large indexes', () => {
      const stats = { ...healthyStats, m: 4, indexedVectors: 20000 };
      const health = monitor.assess(stats);
      expect(health.recommendations.some((r) => r.includes('M=4'))).toBe(true);
    });

    it('should flag low efConstruction for large indexes', () => {
      const stats = { ...healthyStats, efConstruction: 50, indexedVectors: 10000 };
      const health = monitor.assess(stats);
      expect(health.recommendations.some((r) => r.includes('efConstruction=50'))).toBe(true);
    });

    it('should flag high insert latency', () => {
      for (let i = 0; i < 10; i++) {
        monitor.recordInsert(20); // 20ms average
      }
      const health = monitor.assess(healthyStats);
      expect(health.avgInsertMs).toBe(20);
      expect(health.recommendations.some((r) => r.toLowerCase().includes('insert latency'))).toBe(true);
    });

    it('should handle empty latency arrays', () => {
      const health = monitor.assess(healthyStats);
      expect(health.avgSearchMs).toBe(0);
      expect(health.avgInsertMs).toBe(0);
    });
  });

  describe('sample management', () => {
    it('should cap samples at maxSamples', () => {
      // Record more than 1000 samples
      for (let i = 0; i < 1200; i++) {
        monitor.recordSearch(i);
      }
      // Average should be skewed toward higher values (first 200 shifted out)
      const health = monitor.assess(healthyStats);
      expect(health.avgSearchMs).toBeGreaterThan(500);
    });

    it('should reset all samples', () => {
      for (let i = 0; i < 10; i++) {
        monitor.recordSearch(100);
        monitor.recordInsert(50);
      }
      monitor.reset();
      const health = monitor.assess(healthyStats);
      expect(health.avgSearchMs).toBe(0);
      expect(health.avgInsertMs).toBe(0);
    });
  });
});
