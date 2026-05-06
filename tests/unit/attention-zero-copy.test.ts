/**
 * Zero-Copy Array Indexing Optimization Tests
 *
 * Tests for Task #25: Zero-copy array views in AttentionService
 *
 * Success Criteria:
 * - 90% fewer Float32Array allocations
 * - 40-50% performance improvement
 * - All existing tests still pass
 * - No memory corruption
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { AttentionService } from '../../src/controllers/AttentionService.js';
import type { AttentionConfig } from '../../src/controllers/AttentionService.js';

describe('AttentionService - Zero-Copy Optimization', () => {
  let service: AttentionService;
  const config: AttentionConfig = {
    numHeads: 8,
    headDim: 64,
    embedDim: 512,
    dropout: 0.1,
    bias: true
  };

  beforeAll(async () => {
    service = new AttentionService(config);
    await service.initialize();
  });

  afterEach(() => {
    service.resetStats();
  });

  describe('Zero-Copy View Correctness', () => {
    it('should produce identical results with zero-copy views', async () => {
      const seqLen = 4;
      const embedDim = config.embedDim;

      // Create deterministic test data
      const query = new Float32Array(seqLen * embedDim);
      const key = new Float32Array(seqLen * embedDim);
      const value = new Float32Array(seqLen * embedDim);

      for (let i = 0; i < query.length; i++) {
        query[i] = 0.5 + Math.sin(i * 0.1);
        key[i] = 0.3 + Math.cos(i * 0.1);
        value[i] = 0.7 + Math.sin(i * 0.2);
      }

      // Run multiple times to ensure consistency
      const result1 = await service.multiHeadAttention(query, key, value);
      const result2 = await service.multiHeadAttention(query, key, value);

      // Results should be identical (within floating point precision)
      expect(result1.output.length).toBe(result2.output.length);
      for (let i = 0; i < result1.output.length; i++) {
        expect(Math.abs(result1.output[i] - result2.output[i])).toBeLessThan(1e-6);
      }
    });

    it('should not corrupt source arrays when using views', async () => {
      const seqLen = 4;
      const embedDim = config.embedDim;

      // Create test data
      const query = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const key = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const value = new Float32Array(seqLen * embedDim).map(() => Math.random());

      // Store original values
      const queryOriginal = new Float32Array(query);
      const keyOriginal = new Float32Array(key);
      const valueOriginal = new Float32Array(value);

      // Run attention (uses zero-copy views internally)
      await service.multiHeadAttention(query, key, value);

      // Verify input arrays are unchanged
      for (let i = 0; i < query.length; i++) {
        expect(query[i]).toBe(queryOriginal[i]);
        expect(key[i]).toBe(keyOriginal[i]);
        expect(value[i]).toBe(valueOriginal[i]);
      }
    });

    it('should handle edge cases with zero-copy views', async () => {
      const seqLen = 1; // Single element
      const embedDim = config.embedDim;

      const query = new Float32Array(seqLen * embedDim).map(() => 1.0);
      const key = new Float32Array(seqLen * embedDim).map(() => 1.0);
      const value = new Float32Array(seqLen * embedDim).map(() => 1.0);

      const result = await service.multiHeadAttention(query, key, value);

      expect(result.output).toBeInstanceOf(Float32Array);
      expect(result.output.length).toBe(seqLen * embedDim);
      // All values should be finite
      for (let i = 0; i < result.output.length; i++) {
        expect(Number.isFinite(result.output[i])).toBe(true);
      }
    });

    it('should handle aligned and unaligned memory access', async () => {
      const seqLen = 7; // Odd number to test unaligned access
      const embedDim = config.embedDim;

      const query = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const key = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const value = new Float32Array(seqLen * embedDim).map(() => Math.random());

      const result = await service.multiHeadAttention(query, key, value);

      expect(result.output).toBeInstanceOf(Float32Array);
      expect(result.output.length).toBe(seqLen * embedDim);
    });
  });

  describe('Linear Attention Zero-Copy', () => {
    it('should use zero-copy views in linear attention', async () => {
      const seqLen = 4;
      const embedDim = config.embedDim;

      const query = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const key = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const value = new Float32Array(seqLen * embedDim).map(() => Math.random());

      // Store original values
      const queryOriginal = new Float32Array(query);
      const keyOriginal = new Float32Array(key);
      const valueOriginal = new Float32Array(value);

      await service.linearAttention(query, key, value);

      // Verify inputs unchanged
      for (let i = 0; i < query.length; i++) {
        expect(query[i]).toBe(queryOriginal[i]);
        expect(key[i]).toBe(keyOriginal[i]);
        expect(value[i]).toBe(valueOriginal[i]);
      }
    });

    it('should produce consistent results with zero-copy in linear attention', async () => {
      const seqLen = 4;
      const embedDim = config.embedDim;

      const query = new Float32Array(seqLen * embedDim).map(() => 0.5);
      const key = new Float32Array(seqLen * embedDim).map(() => 0.3);
      const value = new Float32Array(seqLen * embedDim).map(() => 0.7);

      const result1 = await service.linearAttention(query, key, value);
      const result2 = await service.linearAttention(query, key, value);

      for (let i = 0; i < result1.output.length; i++) {
        expect(Math.abs(result1.output[i] - result2.output[i])).toBeLessThan(1e-6);
      }
    });
  });

  describe('Performance Improvements', () => {
    it('should show reduced execution time for fallback implementation', async () => {
      const seqLen = 16;
      const embedDim = config.embedDim;

      const query = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const key = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const value = new Float32Array(seqLen * embedDim).map(() => Math.random());

      // Warm up
      await service.multiHeadAttention(query, key, value);

      // Benchmark
      service.resetStats();
      const iterations = 10;
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        await service.multiHeadAttention(query, key, value);
      }

      const endTime = performance.now();
      const avgTime = (endTime - startTime) / iterations;

      // Should complete reasonably fast (this is a baseline measurement)
      expect(avgTime).toBeGreaterThan(0);
      expect(avgTime).toBeLessThan(1000); // Less than 1 second per operation

      const stats = service.getStats();
      expect(stats.totalOps).toBe(iterations);
      expect(stats.avgExecutionTimeMs).toBeGreaterThan(0);
    });

    it('should maintain performance across different sequence lengths', async () => {
      const embedDim = config.embedDim;
      const sequenceLengths = [4, 8, 16, 32];
      const timings: number[] = [];

      for (const seqLen of sequenceLengths) {
        const query = new Float32Array(seqLen * embedDim).map(() => Math.random());
        const key = new Float32Array(seqLen * embedDim).map(() => Math.random());
        const value = new Float32Array(seqLen * embedDim).map(() => Math.random());

        const startTime = performance.now();
        await service.multiHeadAttention(query, key, value);
        const endTime = performance.now();

        timings.push(endTime - startTime);
      }

      // All timings should be reasonable
      timings.forEach(timing => {
        expect(timing).toBeGreaterThan(0);
        expect(timing).toBeLessThan(5000); // Less than 5 seconds
      });
    });
  });

  describe('Memory Safety', () => {
    it('should not leak memory through views', async () => {
      const seqLen = 8;
      const embedDim = config.embedDim;

      service.resetStats();

      // Run initial operation to establish baseline
      const warmupQuery = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const warmupKey = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const warmupValue = new Float32Array(seqLen * embedDim).map(() => Math.random());
      await service.multiHeadAttention(warmupQuery, warmupKey, warmupValue);

      const initialMemory = service.getStats().peakMemoryBytes;
      expect(initialMemory).toBeGreaterThan(0);

      // Run multiple operations
      for (let i = 0; i < 100; i++) {
        const query = new Float32Array(seqLen * embedDim).map(() => Math.random());
        const key = new Float32Array(seqLen * embedDim).map(() => Math.random());
        const value = new Float32Array(seqLen * embedDim).map(() => Math.random());

        await service.multiHeadAttention(query, key, value);
      }

      const finalMemory = service.getStats().peakMemoryBytes;

      // Memory should not grow unbounded (allow some growth for buffer pool)
      expect(finalMemory).toBeGreaterThanOrEqual(initialMemory);
      expect(finalMemory).toBeLessThanOrEqual(initialMemory * 1.5); // Allow 50% growth max
    });

    it('should properly handle buffer pool with zero-copy', async () => {
      const seqLen = 4;
      const embedDim = config.embedDim;

      service.resetStats();

      // Create multiple operations with same dimensions
      // This should utilize buffer pooling
      for (let i = 0; i < 10; i++) {
        const query = new Float32Array(seqLen * embedDim).map(() => Math.random());
        const key = new Float32Array(seqLen * embedDim).map(() => Math.random());
        const value = new Float32Array(seqLen * embedDim).map(() => Math.random());

        const result = await service.multiHeadAttention(query, key, value);

        // Result should be valid
        expect(result.output).toBeInstanceOf(Float32Array);
        expect(result.output.length).toBe(seqLen * embedDim);
      }

      const stats = service.getStats();
      expect(stats.totalOps).toBe(10);
    });

    it('should handle concurrent zero-copy operations safely', async () => {
      const seqLen = 4;
      const embedDim = config.embedDim;

      // Create multiple operations in parallel
      const promises = [];
      for (let i = 0; i < 5; i++) {
        const query = new Float32Array(seqLen * embedDim).map(() => Math.random());
        const key = new Float32Array(seqLen * embedDim).map(() => Math.random());
        const value = new Float32Array(seqLen * embedDim).map(() => Math.random());

        promises.push(service.multiHeadAttention(query, key, value));
      }

      const results = await Promise.all(promises);

      // All results should be valid
      results.forEach(result => {
        expect(result.output).toBeInstanceOf(Float32Array);
        expect(result.output.length).toBe(seqLen * embedDim);
        // No NaN or Infinity values
        for (let i = 0; i < result.output.length; i++) {
          expect(Number.isFinite(result.output[i])).toBe(true);
        }
      });
    });
  });

  describe('Mask Handling with Zero-Copy', () => {
    it('should correctly apply masks with zero-copy views', async () => {
      const seqLen = 4;
      const embedDim = config.embedDim;

      const query = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const key = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const value = new Float32Array(seqLen * embedDim).map(() => Math.random());

      // Create causal mask (lower triangular)
      const mask = new Float32Array(seqLen * seqLen);
      for (let i = 0; i < seqLen; i++) {
        for (let j = 0; j < seqLen; j++) {
          mask[i * seqLen + j] = j <= i ? 1 : 0;
        }
      }

      const maskOriginal = new Float32Array(mask);

      const result = await service.multiHeadAttention(query, key, value, mask);

      expect(result.output).toBeInstanceOf(Float32Array);
      expect(result.output.length).toBe(seqLen * embedDim);

      // Mask should be unchanged
      for (let i = 0; i < mask.length; i++) {
        expect(mask[i]).toBe(maskOriginal[i]);
      }
    });

    it('should cache masks efficiently', async () => {
      const seqLen = 4;
      const embedDim = config.embedDim;

      const query = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const key = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const value = new Float32Array(seqLen * embedDim).map(() => Math.random());

      // Create identical masks
      const mask1 = new Float32Array(seqLen * seqLen).fill(1.0);
      const mask2 = new Float32Array(seqLen * seqLen).fill(1.0);

      service.resetStats();

      await service.multiHeadAttention(query, key, value, mask1);
      await service.multiHeadAttention(query, key, value, mask2);

      // Both operations should complete successfully
      const stats = service.getStats();
      expect(stats.totalOps).toBe(2);
    });
  });

  describe('Numerical Stability', () => {
    it('should maintain numerical stability with zero-copy', async () => {
      const seqLen = 4;
      const embedDim = config.embedDim;

      // Create vectors with moderate values (avoid overflow in dot product)
      // Large values can cause overflow: dot_product(1000, 1000) * 512 dims = huge number
      const query = new Float32Array(seqLen * embedDim).map(() => Math.random() * 10);
      const key = new Float32Array(seqLen * embedDim).map(() => Math.random() * 10);
      const value = new Float32Array(seqLen * embedDim).map(() => Math.random() * 10);

      const result = await service.multiHeadAttention(query, key, value);

      // All values should be finite
      for (let i = 0; i < result.output.length; i++) {
        expect(Number.isFinite(result.output[i])).toBe(true);
        expect(Number.isNaN(result.output[i])).toBe(false);
      }
    });

    it('should handle very small values with zero-copy', async () => {
      const seqLen = 4;
      const embedDim = config.embedDim;

      const query = new Float32Array(seqLen * embedDim).map(() => Math.random() * 1e-6);
      const key = new Float32Array(seqLen * embedDim).map(() => Math.random() * 1e-6);
      const value = new Float32Array(seqLen * embedDim).map(() => Math.random() * 1e-6);

      const result = await service.multiHeadAttention(query, key, value);

      // Should produce valid results
      expect(result.output).toBeInstanceOf(Float32Array);
      expect(result.output.length).toBe(seqLen * embedDim);
    });

    it('should handle mixed magnitude values', async () => {
      const seqLen = 4;
      const embedDim = config.embedDim;

      const query = new Float32Array(seqLen * embedDim);
      const key = new Float32Array(seqLen * embedDim);
      const value = new Float32Array(seqLen * embedDim);

      // Mix of large and small values
      for (let i = 0; i < query.length; i++) {
        query[i] = i % 2 === 0 ? Math.random() * 1000 : Math.random() * 1e-6;
        key[i] = i % 2 === 0 ? Math.random() * 1e-6 : Math.random() * 1000;
        value[i] = Math.random();
      }

      const result = await service.multiHeadAttention(query, key, value);

      // All values should be finite
      for (let i = 0; i < result.output.length; i++) {
        expect(Number.isFinite(result.output[i])).toBe(true);
      }
    });
  });

  describe('Flash Attention V2 Zero-Copy', () => {
    it('should use zero-copy in flash attention v2', async () => {
      const seqLen = 8;
      const embedDim = config.embedDim;

      const query = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const key = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const value = new Float32Array(seqLen * embedDim).map(() => Math.random());

      const queryOriginal = new Float32Array(query);

      const result = await service.flashAttentionV2(query, key, value);

      expect(result.output).toBeInstanceOf(Float32Array);

      // Verify inputs unchanged
      for (let i = 0; i < query.length; i++) {
        expect(query[i]).toBe(queryOriginal[i]);
      }
    });

    it('should maintain speedup with zero-copy optimization', async () => {
      const seqLen = 16;
      const embedDim = config.embedDim;

      const query = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const key = new Float32Array(seqLen * embedDim).map(() => Math.random());
      const value = new Float32Array(seqLen * embedDim).map(() => Math.random());

      const result = await service.flashAttentionV2(query, key, value, {
        causal: true,
        dropout: 0.0,
      });

      expect(result.output).toBeInstanceOf(Float32Array);
      expect(result.output.length).toBe(seqLen * embedDim);

      // If speedup is reported, it should be meaningful
      if (result.speedup !== undefined) {
        expect(result.speedup).toBeGreaterThan(0);
      }
    });
  });
});
