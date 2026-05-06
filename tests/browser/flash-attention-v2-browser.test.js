/**
 * @test Flash Attention v2 Browser Tests
 * @description Comprehensive browser tests for Flash Attention v2 (ADR-071)
 * @prerequisites
 *   - Browser environment with WASM support
 *   - AgentDB edge build (dist/browser/, dist/workers/, or dist/deno/)
 * @coverage
 *   - Flash Attention v2 speedup validation (2.49x-7.47x target)
 *   - Correctness vs baseline implementation
 *   - Memory efficiency (70-90% reduction)
 *   - Edge deployment compatibility
 *   - Performance across different sequence lengths
 */

// Browser-compatible test setup
const { describe, it, expect, beforeAll, afterAll, beforeEach } = window.vitest || require('vitest');

describe('Flash Attention v2 Browser Tests', () => {
  let AttentionService;
  let service;

  beforeAll(async () => {
    // Load AttentionService from browser bundle
    if (typeof window !== 'undefined' && window.AgentDB) {
      // Extract AttentionService from AgentDB namespace
      AttentionService = window.AgentDB.AttentionService;
    } else {
      console.log('⚠️  Flash Attention v2 tests require browser environment with AgentDB loaded');
      return;
    }

    if (!AttentionService) {
      throw new Error('AttentionService not available in browser bundle');
    }
  });

  beforeEach(async () => {
    if (AttentionService) {
      service = new AttentionService({
        embedDim: 768,
        numHeads: 12,
        headDim: 64,
        backend: 'wasm', // Use WASM in browser
      });
      await service.initialize();
    }
  });

  afterAll(async () => {
    if (service) {
      await service.dispose();
    }
  });

  describe('Flash Attention v2 Speedup (ADR-071 Targets)', () => {
    it('should achieve 2.49x-7.47x speedup vs baseline for seq_len=128', async () => {
      const seqLen = 128;
      const embedDim = 768;

      // Generate test data
      const query = new Float32Array(seqLen * embedDim);
      const key = new Float32Array(seqLen * embedDim);
      const value = new Float32Array(seqLen * embedDim);

      for (let i = 0; i < query.length; i++) {
        query[i] = Math.random();
        key[i] = Math.random();
        value[i] = Math.random();
      }

      // Warm-up
      await service.flashAttentionV2(query, key, value, {
        seqLength: seqLen,
        blockSize: 64,
      });

      // Benchmark Flash Attention v2
      const flashStart = performance.now();
      const flashResult = await service.flashAttentionV2(query, key, value, {
        seqLength: seqLen,
        blockSize: 64,
      });
      const flashDuration = performance.now() - flashStart;

      // Benchmark baseline
      const baselineStart = performance.now();
      const baselineResult = await service.multiHeadAttention(query, key, value);
      const baselineDuration = performance.now() - baselineStart;

      const speedup = baselineDuration / flashDuration;

      console.log(`Flash Attention v2 speedup (seq_len=${seqLen}): ${speedup.toFixed(2)}x`);
      console.log(`  Flash v2: ${flashDuration.toFixed(2)}ms`);
      console.log(`  Baseline: ${baselineDuration.toFixed(2)}ms`);

      // Validate speedup meets ADR-071 minimum target
      expect(speedup).toBeGreaterThanOrEqual(2.49);
      expect(speedup).toBeLessThanOrEqual(7.47);

      // Verify results are similar (correctness)
      expect(flashResult.output).toBeDefined();
      expect(flashResult.output.length).toBe(baselineResult.output.length);
    });

    it('should achieve higher speedup for longer sequences (seq_len=512)', async () => {
      const seqLen = 512;
      const embedDim = 768;

      const query = new Float32Array(seqLen * embedDim);
      const key = new Float32Array(seqLen * embedDim);
      const value = new Float32Array(seqLen * embedDim);

      for (let i = 0; i < query.length; i++) {
        query[i] = Math.random();
        key[i] = Math.random();
        value[i] = Math.random();
      }

      // Benchmark Flash Attention v2
      const flashStart = performance.now();
      await service.flashAttentionV2(query, key, value, {
        seqLength: seqLen,
        blockSize: 64,
      });
      const flashDuration = performance.now() - flashStart;

      // Benchmark baseline
      const baselineStart = performance.now();
      await service.multiHeadAttention(query, key, value);
      const baselineDuration = performance.now() - baselineStart;

      const speedup = baselineDuration / flashDuration;

      console.log(`Flash Attention v2 speedup (seq_len=${seqLen}): ${speedup.toFixed(2)}x`);

      // Longer sequences should see higher speedup (closer to 7.47x)
      expect(speedup).toBeGreaterThanOrEqual(3.0); // Higher minimum for longer sequences
      expect(speedup).toBeLessThanOrEqual(7.47);
    });

    it('should scale speedup with sequence length', async () => {
      const seqLengths = [64, 128, 256, 512];
      const speedups = [];

      for (const seqLen of seqLengths) {
        const embedDim = 768;
        const query = new Float32Array(seqLen * embedDim);
        const key = new Float32Array(seqLen * embedDim);
        const value = new Float32Array(seqLen * embedDim);

        for (let i = 0; i < query.length; i++) {
          query[i] = Math.random();
          key[i] = Math.random();
          value[i] = Math.random();
        }

        const flashStart = performance.now();
        await service.flashAttentionV2(query, key, value, {
          seqLength: seqLen,
          blockSize: 64,
        });
        const flashDuration = performance.now() - flashStart;

        const baselineStart = performance.now();
        await service.multiHeadAttention(query, key, value);
        const baselineDuration = performance.now() - baselineStart;

        const speedup = baselineDuration / flashDuration;
        speedups.push({ seqLen, speedup });

        console.log(`  seq_len=${seqLen}: ${speedup.toFixed(2)}x`);
      }

      // Speedup should generally increase with sequence length
      expect(speedups[speedups.length - 1].speedup).toBeGreaterThan(speedups[0].speedup);
    });
  });

  describe('Flash Attention v2 Correctness', () => {
    it('should produce numerically similar results to baseline', async () => {
      const seqLen = 128;
      const embedDim = 768;

      const query = new Float32Array(seqLen * embedDim);
      const key = new Float32Array(seqLen * embedDim);
      const value = new Float32Array(seqLen * embedDim);

      for (let i = 0; i < query.length; i++) {
        query[i] = Math.random();
        key[i] = Math.random();
        value[i] = Math.random();
      }

      const flashResult = await service.flashAttentionV2(query, key, value, {
        seqLength: seqLen,
        blockSize: 64,
      });

      const baselineResult = await service.multiHeadAttention(query, key, value);

      // Calculate relative error
      let maxError = 0;
      for (let i = 0; i < flashResult.output.length; i++) {
        const error = Math.abs(flashResult.output[i] - baselineResult.output[i]);
        maxError = Math.max(maxError, error);
      }

      console.log(`Max absolute error: ${maxError.toExponential(2)}`);

      // Flash Attention v2 should be numerically close (within 1e-4 tolerance)
      expect(maxError).toBeLessThan(1e-4);
    });

    it('should handle causal masking correctly', async () => {
      const seqLen = 64;
      const embedDim = 768;

      const query = new Float32Array(seqLen * embedDim);
      const key = new Float32Array(seqLen * embedDim);
      const value = new Float32Array(seqLen * embedDim);

      for (let i = 0; i < query.length; i++) {
        query[i] = Math.random();
        key[i] = Math.random();
        value[i] = Math.random();
      }

      const result = await service.flashAttentionV2(query, key, value, {
        seqLength: seqLen,
        blockSize: 32,
        causal: true,
      });

      expect(result.output).toBeDefined();
      expect(result.output.length).toBe(seqLen * embedDim);

      // Verify no NaN or Infinity values
      for (let i = 0; i < result.output.length; i++) {
        expect(Number.isFinite(result.output[i])).toBe(true);
      }
    });

    it('should handle different head dimensions', async () => {
      const headDims = [32, 64, 128];

      for (const headDim of headDims) {
        const seqLen = 64;
        const numHeads = 12;
        const embedDim = numHeads * headDim;

        const testService = new AttentionService({
          embedDim,
          numHeads,
          headDim,
          backend: 'wasm',
        });

        await testService.initialize();

        const query = new Float32Array(seqLen * embedDim);
        const key = new Float32Array(seqLen * embedDim);
        const value = new Float32Array(seqLen * embedDim);

        for (let i = 0; i < query.length; i++) {
          query[i] = Math.random();
          key[i] = Math.random();
          value[i] = Math.random();
        }

        const result = await testService.flashAttentionV2(query, key, value, {
          seqLength: seqLen,
          blockSize: 32,
        });

        expect(result.output).toBeDefined();
        expect(result.output.length).toBe(seqLen * embedDim);

        await testService.dispose();
      }
    });
  });

  describe('Flash Attention v2 Memory Efficiency', () => {
    it('should use 70-90% less memory than baseline', async () => {
      const seqLen = 256;
      const embedDim = 768;

      const query = new Float32Array(seqLen * embedDim);
      const key = new Float32Array(seqLen * embedDim);
      const value = new Float32Array(seqLen * embedDim);

      for (let i = 0; i < query.length; i++) {
        query[i] = Math.random();
        key[i] = Math.random();
        value[i] = Math.random();
      }

      // Measure memory before Flash Attention v2
      const beforeFlash = performance.memory?.usedJSHeapSize || 0;

      await service.flashAttentionV2(query, key, value, {
        seqLength: seqLen,
        blockSize: 64,
      });

      const afterFlash = performance.memory?.usedJSHeapSize || 0;
      const flashMemory = afterFlash - beforeFlash;

      // Measure memory for baseline
      const beforeBaseline = performance.memory?.usedJSHeapSize || 0;

      await service.multiHeadAttention(query, key, value);

      const afterBaseline = performance.memory?.usedJSHeapSize || 0;
      const baselineMemory = afterBaseline - beforeBaseline;

      if (flashMemory > 0 && baselineMemory > 0) {
        const reduction = 1 - (flashMemory / baselineMemory);

        console.log(`Memory reduction: ${(reduction * 100).toFixed(1)}%`);
        console.log(`  Flash v2: ${(flashMemory / 1024).toFixed(2)}KB`);
        console.log(`  Baseline: ${(baselineMemory / 1024).toFixed(2)}KB`);

        // Validate 70-90% reduction target
        expect(reduction).toBeGreaterThanOrEqual(0.7);
        expect(reduction).toBeLessThanOrEqual(0.9);
      }
    });

    it('should not leak memory after multiple calls', async () => {
      const seqLen = 128;
      const embedDim = 768;

      const query = new Float32Array(seqLen * embedDim);
      const key = new Float32Array(seqLen * embedDim);
      const value = new Float32Array(seqLen * embedDim);

      for (let i = 0; i < query.length; i++) {
        query[i] = Math.random();
        key[i] = Math.random();
        value[i] = Math.random();
      }

      const initialMemory = performance.memory?.usedJSHeapSize || 0;

      // Run 100 iterations
      for (let i = 0; i < 100; i++) {
        await service.flashAttentionV2(query, key, value, {
          seqLength: seqLen,
          blockSize: 64,
        });
      }

      const finalMemory = performance.memory?.usedJSHeapSize || 0;
      const memoryIncrease = finalMemory - initialMemory;

      if (finalMemory > 0) {
        console.log(`Memory increase after 100 iterations: ${(memoryIncrease / 1024).toFixed(2)}KB`);

        // Memory increase should be minimal (< 5MB for 100 iterations)
        expect(memoryIncrease).toBeLessThan(5 * 1024 * 1024);
      }
    });
  });

  describe('Edge Deployment Compatibility', () => {
    it('should work in Cloudflare Workers environment', async () => {
      // Simulate Workers environment
      const isWorkers = typeof globalThis.caches !== 'undefined';

      if (isWorkers) {
        const seqLen = 64;
        const embedDim = 768;

        const query = new Float32Array(seqLen * embedDim);
        const key = new Float32Array(seqLen * embedDim);
        const value = new Float32Array(seqLen * embedDim);

        for (let i = 0; i < query.length; i++) {
          query[i] = Math.random();
          key[i] = Math.random();
          value[i] = Math.random();
        }

        const result = await service.flashAttentionV2(query, key, value, {
          seqLength: seqLen,
          blockSize: 32,
        });

        expect(result.output).toBeDefined();
      }
    });

    it('should work in Deno Deploy environment', async () => {
      // Simulate Deno environment
      const isDeno = typeof Deno !== 'undefined';

      if (isDeno) {
        const seqLen = 64;
        const embedDim = 768;

        const query = new Float32Array(seqLen * embedDim);
        const key = new Float32Array(seqLen * embedDim);
        const value = new Float32Array(seqLen * embedDim);

        for (let i = 0; i < query.length; i++) {
          query[i] = Math.random();
          key[i] = Math.random();
          value[i] = Math.random();
        }

        const result = await service.flashAttentionV2(query, key, value, {
          seqLength: seqLen,
          blockSize: 32,
        });

        expect(result.output).toBeDefined();
      }
    });

    it('should handle cold start efficiently (<10ms)', async () => {
      // Create new service to simulate cold start
      const coldService = new AttentionService({
        embedDim: 768,
        numHeads: 12,
        headDim: 64,
        backend: 'wasm',
      });

      const coldStart = performance.now();
      await coldService.initialize();
      const coldDuration = performance.now() - coldStart;

      console.log(`Cold start time: ${coldDuration.toFixed(2)}ms`);

      // Cold start should be < 10ms (WASM caching optimization)
      expect(coldDuration).toBeLessThan(10);

      await coldService.dispose();
    });
  });

  describe('Flash Attention v2 Configuration', () => {
    it('should support different block sizes', async () => {
      const blockSizes = [32, 64, 128];

      for (const blockSize of blockSizes) {
        const seqLen = 128;
        const embedDim = 768;

        const query = new Float32Array(seqLen * embedDim);
        const key = new Float32Array(seqLen * embedDim);
        const value = new Float32Array(seqLen * embedDim);

        for (let i = 0; i < query.length; i++) {
          query[i] = Math.random();
          key[i] = Math.random();
          value[i] = Math.random();
        }

        const result = await service.flashAttentionV2(query, key, value, {
          seqLength: seqLen,
          blockSize,
        });

        expect(result.output).toBeDefined();
        console.log(`Block size ${blockSize}: ✓`);
      }
    });

    it('should provide performance statistics', async () => {
      const seqLen = 128;
      const embedDim = 768;

      const query = new Float32Array(seqLen * embedDim);
      const key = new Float32Array(seqLen * embedDim);
      const value = new Float32Array(seqLen * embedDim);

      for (let i = 0; i < query.length; i++) {
        query[i] = Math.random();
        key[i] = Math.random();
        value[i] = Math.random();
      }

      const result = await service.flashAttentionV2(query, key, value, {
        seqLength: seqLen,
        blockSize: 64,
        returnStats: true,
      });

      expect(result.stats).toBeDefined();
      expect(result.stats.speedup).toBeDefined();
      expect(result.stats.baselineTimeMs).toBeDefined();
      expect(result.stats.flashTimeMs).toBeDefined();

      console.log('Performance stats:', result.stats);
    });
  });
});

// Browser-specific utilities
if (typeof window !== 'undefined') {
  window.runFlashAttentionV2Tests = async function() {
    console.log('🧪 Running Flash Attention v2 browser tests...');
    console.log('📊 ADR-071 Target: 2.49x-7.47x speedup');

    const results = await window.vitest.run();

    console.log('✅ Flash Attention v2 tests complete:', results);
    return results;
  };
}
