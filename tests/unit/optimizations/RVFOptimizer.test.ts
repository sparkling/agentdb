/**
 * Unit Tests for RVFOptimizer
 *
 * Tests RuVector Format optimization patterns (ADR-062, ADR-065):
 * - 4-bit / 8-bit / 16-bit quantization round-trip correctness and bounds
 * - Adaptive quantization by importance score
 * - Progressive multi-level (L1/L2/L3) compression by access count
 * - Zero-copy nibble packing
 * - Quality measurement (cosine / MSE / max error)
 * - Deduplication by cosine similarity
 * - Confidence/age-based pruning
 * - Batch embedding with cache, flush, and stats
 *
 * House style: real RVFOptimizer instances, unique fixtures per test,
 * meaningful numeric assertions on values and invariants.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RVFOptimizer } from '../../../src/optimizations/RVFOptimizer.js';

// --- Deterministic fixtures -------------------------------------------------

/** Evenly spaced ramp; min=0, max=1 sit exactly on 4-bit quantization levels. */
const RAMP_0_1 = [0, 0.25, 0.5, 0.75, 1.0];

/** Larger deterministic vector (no RNG) for compression-ratio / bounds checks. */
function makeRamp(length: number, scale = 1): number[] {
  const out = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    out[i] = (i / (length - 1)) * scale;
  }
  return out;
}

/** Cosine similarity reference implementation for cross-checking. */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

describe('RVFOptimizer', () => {
  let optimizer: RVFOptimizer;

  beforeEach(() => {
    optimizer = new RVFOptimizer();
  });

  describe('constructor / configuration', () => {
    it('applies documented defaults when no config is given', () => {
      const stats = optimizer.getStats();

      expect(stats.config.compression.enabled).toBe(true);
      expect(stats.config.compression.quantizeBits).toBe(8);
      expect(stats.config.compression.deduplicationThreshold).toBeCloseTo(0.95, 10);
      expect(stats.config.pruning.minConfidence).toBeCloseTo(0.3, 10);
      expect(stats.config.batching.batchSize).toBe(32);
      expect(stats.config.caching.maxSize).toBe(10000);
    });

    it('merges partial config without dropping unspecified sub-keys', () => {
      const custom = new RVFOptimizer({
        compression: { quantizeBits: 4 } as any,
      });
      const cfg = custom.getStats().config;

      // Overridden value
      expect(cfg.compression.quantizeBits).toBe(4);
      // Sibling defaults still present
      expect(cfg.compression.enabled).toBe(true);
      expect(cfg.compression.deduplicationThreshold).toBeCloseTo(0.95, 10);
      // Other groups untouched
      expect(cfg.pruning.enabled).toBe(true);
    });
  });

  describe('quantize4Bit', () => {
    it('produces an exact 8x compression ratio (float32 -> 4-bit)', () => {
      const { metrics } = optimizer.quantize4Bit(makeRamp(64));

      expect(metrics.quantizationBits).toBe(4);
      expect(metrics.originalSize).toBe(64 * 4); // 4 bytes / float32
      expect(metrics.compressedSize).toBe(64 * 0.5); // 0.5 bytes / 4-bit
      expect(metrics.compressionRatio).toBe(8);
    });

    it('reconstructs the same length and preserves min/max endpoints exactly', () => {
      const { compressed } = optimizer.quantize4Bit(RAMP_0_1);

      expect(compressed).toHaveLength(RAMP_0_1.length);
      // min (0) and max (1) land exactly on quantization grid endpoints
      expect(compressed[0]).toBe(0);
      expect(compressed[compressed.length - 1]).toBeCloseTo(1, 10);
    });

    it('keeps every reconstructed value within the original min/max range', () => {
      const input = makeRamp(32, 2).map((v) => v - 1); // range [-1, 1]
      const min = Math.min(...input);
      const max = Math.max(...input);

      const { compressed } = optimizer.quantize4Bit(input);

      for (const value of compressed) {
        expect(value).toBeGreaterThanOrEqual(min - 1e-9);
        expect(value).toBeLessThanOrEqual(max + 1e-9);
      }
    });

    it('bounds round-trip error: every element within one quantization step', () => {
      const input = makeRamp(48, 4).map((v) => v - 2); // range [-2, 2]
      const range = Math.max(...input) - Math.min(...input);
      const step = range / 15; // 16 levels => 15 intervals

      const { compressed } = optimizer.quantize4Bit(input);

      for (let i = 0; i < input.length; i++) {
        // Nearest-level rounding => error <= half a step
        expect(Math.abs(compressed[i] - input[i])).toBeLessThanOrEqual(step / 2 + 1e-9);
      }
    });

    it('reports a high but sub-perfect quality score for a smooth ramp', () => {
      const { metrics } = optimizer.quantize4Bit(makeRamp(128));

      expect(metrics.qualityScore).toBeGreaterThan(0.99);
      expect(metrics.qualityScore).toBeLessThanOrEqual(1);
    });
  });

  describe('adaptiveQuantize', () => {
    it('selects 16-bit for high importance (> 0.8)', () => {
      const { metrics } = optimizer.adaptiveQuantize(makeRamp(16), 0.9);
      expect(metrics.quantizationBits).toBe(16);
      expect(metrics.adaptiveBoost).toBe(0.9);
    });

    it('selects 8-bit for moderate importance (0.5 - 0.8)', () => {
      const { metrics } = optimizer.adaptiveQuantize(makeRamp(16), 0.6);
      expect(metrics.quantizationBits).toBe(8);
    });

    it('selects 4-bit for low importance (< 0.5)', () => {
      const { metrics } = optimizer.adaptiveQuantize(makeRamp(16), 0.2);
      expect(metrics.quantizationBits).toBe(4);
    });

    it('higher bit depth yields strictly lower (or equal) reconstruction error', () => {
      const input = makeRamp(64, 3).map((v) => v - 1.5);

      const lo = optimizer.adaptiveQuantize(input, 0.1); // 4-bit
      const hi = optimizer.adaptiveQuantize(input, 0.9); // 16-bit

      const err = (orig: number[], comp: number[]) =>
        orig.reduce((s, v, i) => s + Math.abs(v - comp[i]), 0);

      expect(err(input, hi.compressed)).toBeLessThanOrEqual(err(input, lo.compressed));
      // 16-bit on this range is effectively lossless
      expect(hi.metrics.qualityScore).toBeGreaterThan(0.9999);
    });

    it('falls back to 4-bit quantization when adaptive mode is disabled', () => {
      const noAdaptive = new RVFOptimizer({
        compression: { adaptive: false } as any,
      });
      const { metrics } = noAdaptive.adaptiveQuantize(makeRamp(16), 0.95);
      // Ignores importance, always 4-bit
      expect(metrics.quantizationBits).toBe(4);
    });
  });

  describe('progressiveCompress', () => {
    it('routes cold embeddings (access < 3) to L3 / 16-bit', () => {
      const result = optimizer.progressiveCompress('cold-key', makeRamp(16), 0);
      expect(result.cacheLevel).toBe('L3');
      expect(result.metrics.quantizationBits).toBe(16);
    });

    it('routes warm embeddings (access 3 - 9) to L2 / 8-bit', () => {
      const result = optimizer.progressiveCompress('warm-key', makeRamp(16), 5);
      expect(result.cacheLevel).toBe('L2');
      expect(result.metrics.quantizationBits).toBe(8);
    });

    it('routes hot embeddings (access >= 10) to L1 / 4-bit', () => {
      const result = optimizer.progressiveCompress('hot-key', makeRamp(16), 20);
      expect(result.cacheLevel).toBe('L1');
      expect(result.metrics.quantizationBits).toBe(4);
    });

    it('falls back to L1 / 4-bit when progressive mode is disabled', () => {
      const noProgressive = new RVFOptimizer({
        compression: { progressive: false } as any,
      });
      const result = noProgressive.progressiveCompress('k', makeRamp(16), 0);
      expect(result.cacheLevel).toBe('L1');
      expect(result.metrics.quantizationBits).toBe(4);
    });

    it('encodes access frequency into adaptiveBoost (accessCount / 10)', () => {
      const result = optimizer.progressiveCompress('k', makeRamp(16), 7);
      expect(result.metrics.adaptiveBoost).toBeCloseTo(0.7, 10);
    });
  });

  describe('zeroCopyCompress4Bit', () => {
    it('packs two 4-bit values per byte (ceil(n/2) output length)', () => {
      const evenLen = optimizer.zeroCopyCompress4Bit(new Float32Array(8));
      const oddLen = optimizer.zeroCopyCompress4Bit(new Float32Array(5));

      expect(evenLen).toBeInstanceOf(Int8Array);
      expect(evenLen.length).toBe(4); // 8 / 2
      expect(oddLen.length).toBe(3); // ceil(5 / 2)
    });

    it('packs recoverable nibbles for known endpoint values', () => {
      // [min, max] => quantized [0, 15] => byte (0 << 4) | 15 = 15
      const packed = optimizer.zeroCopyCompress4Bit(new Float32Array([0, 1]));
      // Int8Array stores 15 as 15 (within signed-byte range)
      const byte = packed[0] & 0xff;
      const high = (byte >> 4) & 0x0f;
      const low = byte & 0x0f;

      expect(high).toBe(0); // min -> level 0
      expect(low).toBe(15); // max -> level 15
    });

    it('zero-pads the trailing nibble for odd-length input', () => {
      // [0, 1, 1] has range [0,1]; the lone trailing max packs into the high
      // nibble of byte 1, while the absent pair element pads the low nibble to 0.
      const packed = optimizer.zeroCopyCompress4Bit(new Float32Array([0, 1, 1]));
      expect(packed.length).toBe(2); // ceil(3 / 2)

      const tail = packed[1] & 0xff; // mask signed Int8 back to unsigned byte
      expect((tail >> 4) & 0x0f).toBe(15); // trailing value -> level 15 (high nibble)
      expect(tail & 0x0f).toBe(0); // padded low nibble
    });
  });

  describe('measureQuality', () => {
    it('reports perfect similarity and zero error for identical vectors', () => {
      const q = optimizer.measureQuality([1, 2, 3, 4], [1, 2, 3, 4]);
      expect(q.cosineSimilarity).toBeCloseTo(1, 12);
      expect(q.mse).toBe(0);
      expect(q.maxError).toBe(0);
    });

    it('computes MSE and max error against a reference', () => {
      // errors: [0, 0, 1] => mse = (0 + 0 + 1) / 3, maxError = 1
      const q = optimizer.measureQuality([1, 2, 3], [1, 2, 4]);
      expect(q.maxError).toBe(1);
      expect(q.mse).toBeCloseTo(1 / 3, 12);
      expect(q.cosineSimilarity).toBeCloseTo(cosine([1, 2, 3], [1, 2, 4]), 12);
    });

    it('agrees with measured quality from quantize4Bit', () => {
      const input = makeRamp(100);
      const { compressed, metrics } = optimizer.quantize4Bit(input);
      const q = optimizer.measureQuality(input, compressed);

      expect(q.cosineSimilarity).toBeCloseTo(metrics.qualityScore, 12);
      expect(q.mse).toBeGreaterThanOrEqual(0);
      expect(q.maxError).toBeGreaterThanOrEqual(0);
    });
  });

  describe('compressEmbedding / compressFloat32', () => {
    it('returns the SAME reference (identity passthrough) when disabled', () => {
      const off = new RVFOptimizer({ compression: { enabled: false } as any });
      const input = makeRamp(10);
      expect(off.compressEmbedding(input)).toBe(input);

      const f32 = new Float32Array(makeRamp(10));
      expect(off.compressFloat32(f32)).toBe(f32);
    });

    it('quantizes using the configured bit depth (8-bit default)', () => {
      const input = makeRamp(50, 5);
      const out = optimizer.compressEmbedding(input);

      expect(out).toHaveLength(input.length);
      // 8-bit (256 levels) keeps error very small on a smooth ramp
      const q = optimizer.measureQuality(input, out);
      expect(q.cosineSimilarity).toBeGreaterThan(0.999);
    });

    it('compressFloat32 returns a Float32Array of equal length and bounded error', () => {
      const input = new Float32Array(makeRamp(40, 2).map((v) => v - 1));
      const out = optimizer.compressFloat32(input);

      expect(out).toBeInstanceOf(Float32Array);
      expect(out.length).toBe(input.length);

      const range = Math.max(...input) - Math.min(...input);
      const step = range / 255; // 8-bit
      for (let i = 0; i < input.length; i++) {
        expect(Math.abs(out[i] - input[i])).toBeLessThanOrEqual(step / 2 + 1e-6);
      }
    });
  });

  describe('deduplicate', () => {
    it('removes near-identical embeddings above the threshold, keeping the first seen', () => {
      const items = [
        { id: 'a', embedding: [1, 0, 0], confidence: 0.9 },
        { id: 'b', embedding: [1, 0, 0], confidence: 0.8 }, // duplicate of a
        { id: 'c', embedding: [0, 1, 0], confidence: 0.7 },
      ];

      const unique = optimizer.deduplicate(items);

      expect(unique.map((u) => u.id)).toEqual(['a', 'c']);
    });

    it('keeps embeddings whose similarity is below the dedup threshold', () => {
      const items = [
        { id: 'x', embedding: [1, 0, 0, 0], confidence: 0.9 },
        { id: 'y', embedding: [0, 1, 0, 0], confidence: 0.9 }, // orthogonal -> sim 0
      ];

      const unique = optimizer.deduplicate(items);
      expect(unique).toHaveLength(2);
    });

    it('passes everything through unchanged when compression is disabled', () => {
      const off = new RVFOptimizer({ compression: { enabled: false } as any });
      const items = [
        { id: 'a', embedding: [1, 0, 0], confidence: 0.9 },
        { id: 'b', embedding: [1, 0, 0], confidence: 0.8 },
      ];
      expect(off.deduplicate(items)).toHaveLength(2);
    });

    it('handles an empty input list', () => {
      expect(optimizer.deduplicate([])).toEqual([]);
    });
  });

  describe('pruneMemories', () => {
    const DAY = 24 * 60 * 60 * 1000;

    it('prunes entries below the minimum confidence', () => {
      const now = Date.now();
      const toPrune = optimizer.pruneMemories([
        { id: 'low', confidence: 0.1, timestamp: now },
        { id: 'ok', confidence: 0.9, timestamp: now },
      ]);
      expect(toPrune).toEqual(['low']);
    });

    it('prunes entries older than the maximum age (default 30 days)', () => {
      const now = Date.now();
      const toPrune = optimizer.pruneMemories([
        { id: 'fresh', confidence: 0.9, timestamp: now },
        { id: 'stale', confidence: 0.9, timestamp: now - 40 * DAY },
      ]);
      expect(toPrune).toEqual(['stale']);
    });

    it('prunes on either low confidence OR old age', () => {
      const now = Date.now();
      const toPrune = optimizer.pruneMemories([
        { id: 'keep', confidence: 0.9, timestamp: now },
        { id: 'lowconf', confidence: 0.05, timestamp: now },
        { id: 'old', confidence: 0.99, timestamp: now - 100 * DAY },
      ]);
      expect(toPrune.sort()).toEqual(['lowconf', 'old']);
    });

    it('returns an empty array when pruning is disabled', () => {
      const off = new RVFOptimizer({ pruning: { enabled: false } as any });
      const toPrune = off.pruneMemories([
        { id: 'low', confidence: 0.0, timestamp: 0 },
      ]);
      expect(toPrune).toEqual([]);
    });
  });

  describe('batchEmbed / flush / cache', () => {
    it('returns embeddings for queued queries when the batch fills', async () => {
      const embedFn = async (text: string) => [text.length, 0, 1];
      const opt = new RVFOptimizer({ batching: { batchSize: 2, maxWaitMs: 5 } as any });

      const [a, b] = await Promise.all([
        opt.batchEmbed('aa', embedFn),
        opt.batchEmbed('bbbb', embedFn),
      ]);

      expect(a).toEqual([2, 0, 1]);
      expect(b).toEqual([4, 0, 1]);
    });

    it('flushes a partial batch that has not reached batchSize', async () => {
      let calls = 0;
      const embedFn = async (text: string) => {
        calls++;
        return [text.length];
      };
      const opt = new RVFOptimizer({ batching: { batchSize: 100, maxWaitMs: 10_000 } as any });

      const pending = opt.batchEmbed('hello', embedFn);
      await opt.flush(embedFn);
      const result = await pending;

      expect(result).toEqual([5]);
      expect(calls).toBe(1);
    });

    it('serves repeated queries from cache (embedFn invoked once)', async () => {
      let calls = 0;
      const embedFn = async (text: string) => {
        calls++;
        return [text.length, calls];
      };
      const opt = new RVFOptimizer({ batching: { batchSize: 1, maxWaitMs: 5 } as any });

      const first = await opt.batchEmbed('cached', embedFn);
      const second = await opt.batchEmbed('cached', embedFn);

      expect(first).toEqual(second);
      expect(calls).toBe(1);
    });

    it('bypasses batching entirely when batching is disabled', async () => {
      const embedFn = async (text: string) => [text.length];
      const opt = new RVFOptimizer({ batching: { enabled: false } as any });

      const result = await opt.batchEmbed('direct', embedFn);
      expect(result).toEqual([6]);
    });

    it('clearCache empties the query cache so embedFn runs again', async () => {
      let calls = 0;
      const embedFn = async (text: string) => {
        calls++;
        return [text.length];
      };
      const opt = new RVFOptimizer({ batching: { batchSize: 1, maxWaitMs: 5 } as any });

      await opt.batchEmbed('q', embedFn);
      expect(opt.getStats().cacheSize).toBe(1); // populated by first embed
      opt.clearCache();
      expect(opt.getStats().cacheSize).toBe(0); // emptied by clearCache

      // Re-embedding after a clear must re-invoke embedFn (cache miss).
      await opt.batchEmbed('q', embedFn);
      expect(calls).toBe(2);
    });

    it('propagates embedFn rejection to all queued callers', async () => {
      const failing = async () => {
        throw new Error('embed boom');
      };
      const opt = new RVFOptimizer({ batching: { batchSize: 1, maxWaitMs: 5 } as any });

      await expect(opt.batchEmbed('x', failing)).rejects.toThrow('embed boom');
    });
  });

  describe('getStats / getCacheLevels', () => {
    it('exposes a fresh-state snapshot with empty caches and queue', () => {
      const stats = optimizer.getStats();
      expect(stats.cacheSize).toBe(0);
      expect(stats.batchQueueSize).toBe(0);
      expect(stats.multiLevelCache).toBeDefined();
      expect(stats.multiLevelCache!.l1.hitRate).toBe(0);
    });

    it('describes the L1/L2/L3 hierarchy with ascending bit depth', () => {
      const levels = optimizer.getCacheLevels();
      expect(levels.map((l) => l.name)).toEqual(['L1', 'L2', 'L3']);
      expect(levels.map((l) => l.quantizeBits)).toEqual([4, 8, 16]);
      // All hit rates start at 0 with no traffic
      levels.forEach((l) => expect(l.hitRate).toBe(0));
    });
  });

  describe('edge cases', () => {
    it('handles a single-element vector (zero range guarded)', () => {
      const { compressed, metrics } = optimizer.quantize4Bit([0.42]);
      expect(compressed).toHaveLength(1);
      // With range -> 1e-10 guard, the reconstruction stays finite
      expect(Number.isFinite(compressed[0])).toBe(true);
      expect(metrics.compressionRatio).toBe(8);
    });

    it('handles an all-zero vector without producing NaN', () => {
      const zeros = new Array(16).fill(0);
      const { compressed } = optimizer.quantize4Bit(zeros);
      compressed.forEach((v) => {
        expect(Number.isNaN(v)).toBe(false);
        expect(v).toBe(0);
      });
    });

    it('handles a constant (zero-range) non-zero vector', () => {
      const constant = new Array(8).fill(0.5);
      const { compressed } = optimizer.quantize4Bit(constant);
      // range collapses to epsilon; every value reconstructs back to the min (0.5)
      compressed.forEach((v) => expect(v).toBeCloseTo(0.5, 6));
    });

    it('handles negative-only vectors and preserves ordering of endpoints', () => {
      const negatives = [-1, -0.5, -0.25, -0.75];
      const { compressed } = optimizer.quantize4Bit(negatives);
      expect(Math.min(...compressed)).toBeCloseTo(-1, 6); // min preserved
      expect(Math.max(...compressed)).toBeCloseTo(-0.25, 6); // max preserved
    });

    it('compresses a large 1536-dim vector with stable ratio and bounded loss', () => {
      const large = makeRamp(1536, 10).map((v) => v - 5);
      const { compressed, metrics } = optimizer.quantize4Bit(large);

      expect(compressed).toHaveLength(1536);
      expect(metrics.compressionRatio).toBe(8);
      expect(metrics.qualityScore).toBeGreaterThan(0.99);
    });
  });
});
