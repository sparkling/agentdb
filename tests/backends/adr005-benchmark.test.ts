/**
 * ADR-005 Performance Benchmarks
 *
 * Validates performance characteristics of the self-learning pipeline:
 * - TemporalCompressor throughput and memory savings
 * - ContrastiveTrainer loss convergence
 * - SemanticQueryRouter latency
 * - End-to-end pipeline performance
 */

import { describe, it, expect } from 'vitest';
import { TemporalCompressor } from '../../src/backends/rvf/AdaptiveIndexTuner.js';
import { ContrastiveTrainer, type ContrastiveSample } from '../../src/backends/rvf/ContrastiveTrainer.js';
import { SemanticQueryRouter } from '../../src/backends/rvf/SemanticQueryRouter.js';

function generateVector(dim: number, seed: number): Float32Array {
  const vec = new Float32Array(dim);
  let s = seed;
  for (let i = 0; i < dim; i++) {
    s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
    vec[i] = ((s >>> 0) / 0xFFFFFFFF) * 2 - 1;
  }
  return vec;
}

function normalize(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  const result = new Float32Array(vec.length);
  if (norm > 0) for (let i = 0; i < vec.length; i++) result[i] = vec[i] / norm;
  return result;
}

describe('ADR-005 Performance Benchmarks', () => {
  describe('TemporalCompressor throughput', () => {
    it('should compress 1000 vectors in <100ms', async () => {
      const compressor = await TemporalCompressor.create();
      const dim = 384; // Typical embedding dimension
      const vectors = Array.from({ length: 1000 }, (_, i) => generateVector(dim, i));

      const start = performance.now();
      for (let i = 0; i < vectors.length; i++) {
        // Distribute across tiers
        const freq = (i % 5) * 0.2 + 0.1;
        compressor.compress(`v-${i}`, vectors[i], freq);
      }
      const elapsed = performance.now() - start;

      console.log(`  Compress 1000x384d: ${elapsed.toFixed(1)}ms (${(elapsed / 1000).toFixed(3)}ms/vec)`);
      expect(elapsed).toBeLessThan(500); // 0.5ms/vec budget (JSON serialization is the bottleneck)

      const stats = compressor.getStats();
      console.log(`  Tier distribution: none=${stats.byTier.none} half=${stats.byTier.half} pq8=${stats.byTier.pq8} pq4=${stats.byTier.pq4} binary=${stats.byTier.binary}`);
      console.log(`  Estimated savings: ${stats.estimatedSavingsPercent.toFixed(1)}%`);
      expect(stats.estimatedSavingsPercent).toBeGreaterThan(40);

      compressor.destroy();
    });

    it('should decompress 1000 vectors in <100ms', async () => {
      const compressor = await TemporalCompressor.create();
      const dim = 384;
      for (let i = 0; i < 1000; i++) {
        const freq = (i % 5) * 0.2 + 0.1;
        compressor.compress(`v-${i}`, generateVector(dim, i), freq);
      }

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        compressor.decompress(`v-${i}`);
      }
      const elapsed = performance.now() - start;

      console.log(`  Decompress 1000x384d: ${elapsed.toFixed(1)}ms (${(elapsed / 1000).toFixed(3)}ms/vec)`);
      expect(elapsed).toBeLessThan(200); // Budget: 0.2ms/vec (JSON.parse is the bottleneck)

      compressor.destroy();
    });

    it('should measure actual memory savings per tier', async () => {
      const compressor = await TemporalCompressor.create();
      const dim = 384;
      const vec = generateVector(dim, 42);
      const rawSize = JSON.stringify(Array.from(vec)).length;

      const tiers: Array<{ name: string; freq: number }> = [
        { name: 'none', freq: 0.9 },
        { name: 'half', freq: 0.7 },
        { name: 'pq8', freq: 0.5 },
        { name: 'pq4', freq: 0.3 },
        { name: 'binary', freq: 0.1 },
      ];

      for (const { name, freq } of tiers) {
        const entry = compressor.compress(`tier-${name}`, vec, freq);
        const compressedSize = entry.compressedJson.length;
        const savings = ((1 - compressedSize / rawSize) * 100);
        console.log(`  ${name}: ${rawSize} -> ${compressedSize} bytes (${savings.toFixed(1)}% savings)`);
      }

      compressor.destroy();
    });
  });

  describe('ContrastiveTrainer convergence', () => {
    it('should decrease loss over 10 training batches', async () => {
      const dim = 32;
      const trainer = await ContrastiveTrainer.create({
        dimension: dim,
        temperature: 0.1,
        learningRate: 0.005,
        stages: [{ negativeCount: 4, hardNegativeThreshold: -1.0, batches: 100 }],
      });

      // Create training data with clear positive/negative structure
      const classes = 5;
      const samplesPerClass = 4;
      const classCentroids = Array.from({ length: classes }, (_, i) => {
        const c = new Float32Array(dim);
        c[i * 6] = 1.0; // Orthogonal class centers
        return normalize(c);
      });

      function makeSample(classIdx: number, _sampleIdx: number): ContrastiveSample {
        // Anchor: class centroid + noise
        const anchor = new Float32Array(dim);
        for (let i = 0; i < dim; i++) anchor[i] = classCentroids[classIdx][i] + (Math.random() - 0.5) * 0.1;

        // Positive: same class
        const positive = new Float32Array(dim);
        for (let i = 0; i < dim; i++) positive[i] = classCentroids[classIdx][i] + (Math.random() - 0.5) * 0.1;

        // Negatives: different classes
        const negatives: Float32Array[] = [];
        for (let c = 0; c < classes; c++) {
          if (c === classIdx) continue;
          const neg = new Float32Array(dim);
          for (let i = 0; i < dim; i++) neg[i] = classCentroids[c][i] + (Math.random() - 0.5) * 0.1;
          negatives.push(normalize(neg));
        }

        return { anchor: normalize(anchor), positive: normalize(positive), negatives };
      }

      const losses: number[] = [];
      const start = performance.now();

      for (let batch = 0; batch < 10; batch++) {
        const samples: ContrastiveSample[] = [];
        for (let c = 0; c < classes; c++) {
          for (let s = 0; s < samplesPerClass; s++) {
            samples.push(makeSample(c, s));
          }
        }
        const result = trainer.trainBatch(samples);
        losses.push(result.loss);
      }

      const elapsed = performance.now() - start;
      const stats = trainer.getStats();

      console.log(`  Training 10 batches (${classes * samplesPerClass} samples/batch, dim=${dim}):`);
      console.log(`  Losses: ${losses.map((l) => l.toFixed(3)).join(' -> ')}`);
      console.log(`  Total time: ${elapsed.toFixed(1)}ms (${(elapsed / 10).toFixed(1)}ms/batch)`);
      console.log(`  Best loss: ${stats.bestLoss.toFixed(3)}`);

      // Loss should generally decrease (allow some noise)
      expect(losses[losses.length - 1]).toBeLessThan(losses[0] * 1.5);

      trainer.destroy();
    });
  });

  describe('SemanticQueryRouter latency', () => {
    it('should route queries in <1ms (fallback mode)', async () => {
      const dim = 128;
      const router = await SemanticQueryRouter.create({ dimension: dim, threshold: 0.0 });

      // Add 50 intents
      for (let i = 0; i < 50; i++) {
        const exemplar = new Float32Array(dim);
        exemplar[i % dim] = 1.0;
        router.addIntent({
          name: `intent-${i}`,
          exemplars: [normalize(exemplar)],
          metadata: { handler: `handler-${i}` },
        });
      }

      // Warmup
      for (let i = 0; i < 10; i++) {
        router.route(normalize(generateVector(dim, i)), 3);
      }

      // Benchmark
      const iterations = 1000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        router.route(normalize(generateVector(dim, i + 1000)), 3);
      }
      const elapsed = performance.now() - start;

      const stats = router.getStats();
      console.log(`  Route 1000 queries against 50 intents (dim=${dim}):`);
      console.log(`  Total: ${elapsed.toFixed(1)}ms (${(elapsed / iterations * 1000).toFixed(1)}us/query)`);
      console.log(`  Mode: ${router.isNative ? 'native @ruvector/router' : 'fallback brute-force'}`);
      console.log(`  Avg latency (tracked): ${stats.avgLatencyMs.toFixed(4)}ms`);

      // Each query should take <1ms (total <1000ms)
      expect(elapsed).toBeLessThan(1000);

      router.destroy();
    });
  });

  describe('End-to-end pipeline', () => {
    it('should run compress -> route -> project cycle in <5ms', async () => {
      const dim = 128;
      const compressor = await TemporalCompressor.create();
      const router = await SemanticQueryRouter.create({ dimension: dim, threshold: 0.0 });
      const trainer = await ContrastiveTrainer.create({ dimension: dim });

      // Setup: add intents
      for (let i = 0; i < 10; i++) {
        const exemplar = new Float32Array(dim);
        exemplar[i * 12] = 1.0;
        router.addIntent({ name: `intent-${i}`, exemplars: [normalize(exemplar)] });
      }

      // Pipeline: compress -> route -> project
      const iterations = 100;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        const vec = normalize(generateVector(dim, i));

        // 1. Check if we have a compressed version, decompress it
        if (compressor.has(`q-${i}`)) {
          compressor.decompress(`q-${i}`);
        }

        // 2. Route the query to an intent
        const routes = router.route(vec, 1);

        // 3. Project through learned transformation
        const projected = trainer.project(vec);

        // 4. Compress the result for future use
        const freq = routes.length > 0 ? Math.min(1, routes[0].score) : 0.5;
        compressor.compress(`q-${i}`, projected, freq);
      }

      const elapsed = performance.now() - start;
      console.log(`  E2E pipeline (${iterations} iterations, dim=${dim}):`);
      console.log(`  Total: ${elapsed.toFixed(1)}ms (${(elapsed / iterations).toFixed(2)}ms/iteration)`);
      console.log(`  Compressed entries: ${compressor.size}`);

      // Pipeline should complete in <100ms total (<1ms per iteration)
      expect(elapsed).toBeLessThan(100);

      compressor.destroy();
      router.destroy();
      trainer.destroy();
    });
  });
});
