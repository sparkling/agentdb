/**
 * ContrastiveTrainer + SemanticQueryRouter Tests
 *
 * Tests Phase 3 of ADR-005: Contrastive Embedding Improvement
 * - InfoNCE loss computation
 * - Projection learning
 * - Hard negative mining
 * - Curriculum scheduling
 * - Semantic query routing
 */

import { describe, it, expect } from 'vitest';
import {
  ContrastiveTrainer,
  type ContrastiveSample,
} from '../../src/backends/rvf/ContrastiveTrainer.js';
import {
  SemanticQueryRouter,
} from '../../src/backends/rvf/SemanticQueryRouter.js';

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
  for (let i = 0; i < vec.length; i++) result[i] = vec[i] / norm;
  return result;
}

describe('ContrastiveTrainer', () => {
  const dim = 16; // Small dim for fast tests

  describe('creation', () => {
    it('should create with valid config', async () => {
      const trainer = await ContrastiveTrainer.create({ dimension: dim });
      expect(trainer).toBeDefined();
      expect(trainer.dimension).toBe(dim);
      expect(trainer.isDestroyed).toBe(false);
    });

    it('should reject invalid dimension', async () => {
      await expect(ContrastiveTrainer.create({ dimension: 0 })).rejects.toThrow('dimension');
      await expect(ContrastiveTrainer.create({ dimension: 5000 })).rejects.toThrow('dimension');
      await expect(ContrastiveTrainer.create({ dimension: NaN })).rejects.toThrow('dimension');
    });
  });

  describe('projection', () => {
    it('should project embeddings with near-identity initially', async () => {
      const trainer = await ContrastiveTrainer.create({ dimension: dim });
      const vec = normalize(generateVector(dim, 1));
      const projected = trainer.project(vec);
      expect(projected.length).toBe(dim);

      // Initially near-identity, so projected should be similar to input
      let dot = 0;
      for (let i = 0; i < dim; i++) dot += vec[i] * projected[i];
      // Cosine similarity should be high (close to identity)
      const normP = Math.sqrt(projected.reduce((s, v) => s + v * v, 0));
      const sim = dot / normP;
      expect(sim).toBeGreaterThan(0.9);
    });

    it('should reject wrong dimension', async () => {
      const trainer = await ContrastiveTrainer.create({ dimension: dim });
      expect(() => trainer.project(new Float32Array(dim + 1))).toThrow('dimension');
    });
  });

  describe('InfoNCE loss', () => {
    it('should compute loss for contrastive samples', async () => {
      const trainer = await ContrastiveTrainer.create({ dimension: dim });
      const anchor = normalize(generateVector(dim, 1));
      const positive = normalize(generateVector(dim, 2)); // Similar-ish
      const negatives = [
        normalize(generateVector(dim, 100)),
        normalize(generateVector(dim, 200)),
      ];

      const samples: ContrastiveSample[] = [{ anchor, positive, negatives }];
      const loss = trainer.computeLoss(samples);
      expect(loss).toBeGreaterThan(0);
      expect(Number.isFinite(loss)).toBe(true);
    });

    it('should return 0 for empty batch', async () => {
      const trainer = await ContrastiveTrainer.create({ dimension: dim });
      expect(trainer.computeLoss([])).toBe(0);
    });

    it('should produce lower loss for closer positive pairs', async () => {
      const trainer = await ContrastiveTrainer.create({ dimension: dim });
      const anchor = normalize(generateVector(dim, 1));
      const closePos = new Float32Array(anchor); // Almost identical
      closePos[0] += 0.01;
      const farPos = normalize(generateVector(dim, 999));
      const negs = [normalize(generateVector(dim, 100))];

      const closeLoss = trainer.computeLoss([{ anchor, positive: closePos, negatives: negs }]);
      const farLoss = trainer.computeLoss([{ anchor, positive: farPos, negatives: negs }]);
      expect(closeLoss).toBeLessThan(farLoss);
    });
  });

  describe('training', () => {
    it('should train and update stats', async () => {
      const trainer = await ContrastiveTrainer.create({
        dimension: dim,
        learningRate: 0.01,
      });

      const samples: ContrastiveSample[] = [];
      for (let i = 0; i < 5; i++) {
        samples.push({
          anchor: normalize(generateVector(dim, i)),
          positive: normalize(generateVector(dim, i + 1000)),
          negatives: [
            normalize(generateVector(dim, i + 2000)),
            normalize(generateVector(dim, i + 3000)),
          ],
        });
      }

      const result = trainer.trainBatch(samples);
      expect(result.loss).toBeGreaterThan(0);
      expect(result.batchSize).toBe(5);
      expect(result.avgGradNorm).toBeGreaterThanOrEqual(0);

      const stats = trainer.getStats();
      expect(stats.totalBatches).toBe(1);
      expect(stats.totalSamples).toBe(5);
      expect(stats.avgLoss).toBeGreaterThan(0);
    });
  });

  describe('hard negative mining', () => {
    it('should mine negatives by similarity', async () => {
      // Use low threshold stages so random vectors pass the filter
      const trainer = await ContrastiveTrainer.create({
        dimension: dim,
        stages: [
          { negativeCount: 5, hardNegativeThreshold: -1.0, batches: 100 },
        ],
      });

      const anchor = normalize(generateVector(dim, 1));
      const pool = Array.from({ length: 20 }, (_, i) =>
        normalize(generateVector(dim, i + 100)),
      );

      const negatives = trainer.mineHardNegatives(anchor, pool, new Set(), 5);
      expect(negatives.length).toBeLessThanOrEqual(5);
      expect(negatives.length).toBeGreaterThan(0);
    });

    it('should exclude specified indices', async () => {
      const trainer = await ContrastiveTrainer.create({ dimension: dim });
      const anchor = normalize(generateVector(dim, 1));
      const pool = Array.from({ length: 10 }, (_, i) =>
        normalize(generateVector(dim, i)),
      );

      const excluded = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const negatives = trainer.mineHardNegatives(anchor, pool, excluded, 5);
      expect(negatives.length).toBe(0);
    });
  });

  describe('lifecycle', () => {
    it('should throw after destroy', async () => {
      const trainer = await ContrastiveTrainer.create({ dimension: dim });
      trainer.destroy();
      expect(trainer.isDestroyed).toBe(true);
      expect(() => trainer.project(generateVector(dim, 1))).toThrow('destroyed');
    });
  });
});

describe('SemanticQueryRouter', () => {
  const dim = 8;

  describe('creation', () => {
    it('should create with valid config', async () => {
      const router = await SemanticQueryRouter.create({ dimension: dim });
      expect(router).toBeDefined();
      expect(router.isDestroyed).toBe(false);
    });

    it('should reject invalid dimension', async () => {
      await expect(SemanticQueryRouter.create({ dimension: 0 })).rejects.toThrow();
      await expect(SemanticQueryRouter.create({ dimension: 5000 })).rejects.toThrow();
    });

    it('should detect @ruvector/router availability', async () => {
      const available = await SemanticQueryRouter.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('intent management', () => {
    it('should add and list intents', async () => {
      const router = await SemanticQueryRouter.create({ dimension: dim });
      router.addIntent({
        name: 'math',
        exemplars: [new Float32Array([1, 0, 0, 0, 0, 0, 0, 0])],
      });
      router.addIntent({
        name: 'code',
        exemplars: [new Float32Array([0, 1, 0, 0, 0, 0, 0, 0])],
      });

      const intents = router.getIntents();
      expect(intents).toContain('math');
      expect(intents).toContain('code');
    });

    it('should reject empty name', async () => {
      const router = await SemanticQueryRouter.create({ dimension: dim });
      expect(() => router.addIntent({
        name: '',
        exemplars: [new Float32Array(dim)],
      })).toThrow('name');
    });

    it('should reject wrong dimension', async () => {
      const router = await SemanticQueryRouter.create({ dimension: dim });
      expect(() => router.addIntent({
        name: 'test',
        exemplars: [new Float32Array(dim + 1)],
      })).toThrow('dimension');
    });

    it('should reject empty exemplars', async () => {
      const router = await SemanticQueryRouter.create({ dimension: dim });
      expect(() => router.addIntent({
        name: 'test',
        exemplars: [],
      })).toThrow('exemplar');
    });

    it('should remove intents', async () => {
      const router = await SemanticQueryRouter.create({ dimension: dim });
      router.addIntent({
        name: 'removable',
        exemplars: [new Float32Array(dim)],
      });
      expect(router.removeIntent('removable')).toBe(true);
      expect(router.getIntents()).not.toContain('removable');
    });
  });

  describe('routing (fallback mode)', () => {
    it('should route to closest intent', async () => {
      // Force fallback by creating directly
      const router = await SemanticQueryRouter.create({ dimension: dim, threshold: 0.0 });

      // Only test fallback if native isn't available
      if (router.isNative) return;

      router.addIntent({
        name: 'math',
        exemplars: [normalize(new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]))],
      });
      router.addIntent({
        name: 'code',
        exemplars: [normalize(new Float32Array([0, 1, 0, 0, 0, 0, 0, 0]))],
      });

      const result = router.route(normalize(new Float32Array([0.9, 0.1, 0, 0, 0, 0, 0, 0])), 2);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].intent).toBe('math');
    });
  });

  describe('routing (any mode)', () => {
    it('should route queries and track stats', async () => {
      const router = await SemanticQueryRouter.create({ dimension: dim, threshold: 0.0 });
      router.addIntent({
        name: 'greeting',
        exemplars: [normalize(new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]))],
        metadata: { handler: 'greet' },
      });

      router.route(normalize(new Float32Array([0.8, 0.2, 0, 0, 0, 0, 0, 0])));
      router.route(normalize(new Float32Array([0.7, 0.3, 0, 0, 0, 0, 0, 0])));

      const stats = router.getStats();
      expect(stats.totalQueries).toBe(2);
      expect(stats.intentCount).toBe(1);
      expect(stats.dimension).toBe(dim);
      expect(stats.avgLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should reject wrong query dimension', async () => {
      const router = await SemanticQueryRouter.create({ dimension: dim });
      expect(() => router.route(new Float32Array(dim + 1))).toThrow('dimension');
    });
  });

  describe('lifecycle', () => {
    it('should throw after destroy', async () => {
      const router = await SemanticQueryRouter.create({ dimension: dim });
      router.destroy();
      expect(router.isDestroyed).toBe(true);
      expect(() => router.route(new Float32Array(dim))).toThrow('destroyed');
    });
  });
});
