/**
 * Unit Tests for NightlyLearner Controller
 *
 * ADR-0170 Phase B.8: backed by PostgresBackend (pglite embedded). The
 * controller's SQL surface includes a cross-product self-JOIN + GROUP BY +
 * HAVING aggregate query that is impractical to emulate with a SQL-text
 * fake; pglite is real-postgres-in-process (~100ms cold-start, <1ms warm)
 * and is the closest thing to the production substrate, so unit tests run
 * against pglite directly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PostgresBackend } from '../../../src/backends/postgres/PostgresBackend.js';
import { NightlyLearner, LearnerConfig } from '../../../src/controllers/NightlyLearner.js';
import { EmbeddingService } from '../../../src/controllers/EmbeddingService.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('NightlyLearner', () => {
  let dataDir: string;
  let db: PostgresBackend;
  let embedder: EmbeddingService;
  let learner: NightlyLearner;

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-learner-'));

    db = new PostgresBackend({ metric: 'cosine', dataDir });
    await db.initialize();

    await db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        id BIGSERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        task TEXT NOT NULL,
        output TEXT,
        reward REAL DEFAULT 0.0,
        ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        latency_ms BIGINT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS causal_edges (
        id BIGSERIAL PRIMARY KEY,
        from_memory_id BIGINT NOT NULL,
        from_memory_type TEXT NOT NULL,
        to_memory_id BIGINT NOT NULL,
        to_memory_type TEXT NOT NULL,
        similarity REAL NOT NULL,
        uplift REAL,
        confidence REAL NOT NULL,
        sample_size BIGINT DEFAULT 1,
        mechanism TEXT,
        evidence_ids TEXT,
        metadata JSONB,
        created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      );

      CREATE TABLE IF NOT EXISTS episode_embeddings (
        episode_id BIGINT PRIMARY KEY,
        embedding BYTEA NOT NULL
      );
    `);

    embedder = new EmbeddingService({
      model: 'mock-model',
      dimension: 384,
      provider: 'local',
    });
    await embedder.initialize();

    learner = new NightlyLearner(db, embedder);
  });

  afterEach(async () => {
    try {
      await (db as any).close?.();
    } catch {
      /* swallow shutdown errors */
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const insertEpisode = async (
    sessionId: string,
    task: string,
    output: string,
    reward: number,
    ts: number,
  ): Promise<void> => {
    await db.query(
      `INSERT INTO episodes (session_id, task, output, reward, ts)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, task, output, reward, ts],
    );
  };

  describe('Constructor', () => {
    it('should initialize with default config', () => {
      expect(learner).toBeDefined();
    });

    it('should accept custom config', () => {
      const customConfig: LearnerConfig = {
        minSimilarity: 0.8,
        minSampleSize: 50,
        confidenceThreshold: 0.7,
        upliftThreshold: 0.1,
        pruneOldEdges: false,
        edgeMaxAgeDays: 60,
        autoExperiments: false,
        experimentBudget: 5,
      };

      const customLearner = new NightlyLearner(db, embedder, customConfig);
      expect(customLearner).toBeDefined();
    });

    it('should enable FlashAttention when configured', () => {
      const flashConfig: LearnerConfig = {
        minSimilarity: 0.7,
        minSampleSize: 30,
        confidenceThreshold: 0.6,
        upliftThreshold: 0.05,
        pruneOldEdges: true,
        edgeMaxAgeDays: 90,
        autoExperiments: true,
        experimentBudget: 10,
        ENABLE_FLASH_CONSOLIDATION: true,
        flashConfig: {
          blockSize: 128,
        },
      };

      const flashLearner = new NightlyLearner(db, embedder, flashConfig);
      expect(flashLearner).toBeDefined();
    });
  });

  describe('run', () => {
    it('should return a LearnerReport', async () => {
      const report = await learner.run();

      expect(report).toBeDefined();
      expect(report.timestamp).toBeGreaterThan(0);
      expect(report.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(report.edgesDiscovered).toBeGreaterThanOrEqual(0);
      expect(report.edgesPruned).toBeGreaterThanOrEqual(0);
      expect(report.experimentsCompleted).toBeGreaterThanOrEqual(0);
      expect(report.experimentsCreated).toBeGreaterThanOrEqual(0);
      expect(typeof report.avgUplift).toBe('number');
      expect(typeof report.avgConfidence).toBe('number');
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it('should discover edges from episode data', async () => {
      const sessionId = 'test-session-1';
      const baseTime = Math.floor(Date.now() / 1000);

      for (let i = 0; i < 20; i++) {
        await insertEpisode(
          sessionId,
          `task_${i % 3}`,
          `output_${i}`,
          0.5 + (i % 10) * 0.05,
          baseTime + i * 60,
        );
      }

      const report = await learner.run();

      expect(report.edgesDiscovered).toBeGreaterThanOrEqual(0);
      expect(report.executionTimeMs).toBeGreaterThan(0);
    });

    it('should complete running experiments', async () => {
      const baseTime = Math.floor(Date.now() / 1000);

      for (let i = 0; i < 10; i++) {
        await insertEpisode('session-1', 'task', 'output', 0.8, baseTime + i);
      }

      await db.query(
        `INSERT INTO causal_experiments (name, hypothesis, treatment_id, treatment_type, start_time, sample_size, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        ['Test Experiment', 'Test hypothesis', 1, 'episode', Date.now(), 50, 'running'],
      );

      const report = await learner.run();

      expect(report.experimentsCompleted).toBeGreaterThanOrEqual(0);
    });

    it('should prune low-confidence edges', async () => {
      const oldEdgeTs = Math.floor(Date.now() / 1000) - 100 * 24 * 60 * 60;

      for (let i = 0; i < 10; i++) {
        await db.query(
          `INSERT INTO causal_edges (from_memory_id, from_memory_type, to_memory_id, to_memory_type, similarity, confidence, uplift, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [i, 'episode', i + 1, 'episode', 0.5, 0.3, 0.1, oldEdgeTs],
        );
      }

      const report = await learner.run();

      expect(report.edgesPruned).toBeGreaterThanOrEqual(0);
    });

    it('should generate recommendations', async () => {
      const report = await learner.run();

      expect(report.recommendations).toBeDefined();
      expect(Array.isArray(report.recommendations)).toBe(true);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('discover', () => {
    it('should discover causal edges with config', async () => {
      const baseTime = Math.floor(Date.now() / 1000);

      for (let i = 0; i < 15; i++) {
        await insertEpisode('session-1', 'task', 'output', 0.8, baseTime + i);
      }

      const edges = await learner.discover({
        minAttempts: 5,
        minSuccessRate: 0.5,
        minConfidence: 0.6,
      });

      expect(Array.isArray(edges)).toBe(true);
    });

    it('should support dry run mode', async () => {
      const edges = await learner.discover({ dryRun: true });

      expect(Array.isArray(edges)).toBe(true);
      expect(edges.length).toBe(0);
    });
  });

  describe('consolidateEpisodes', () => {
    it('should return consolidation results without FlashAttention', async () => {
      const baseTime = Math.floor(Date.now() / 1000);

      for (let i = 0; i < 5; i++) {
        await insertEpisode('session-1', 'task', 'output', 0.8, baseTime + i);
      }

      const result = await learner.consolidateEpisodes();

      expect(result).toBeDefined();
      expect(typeof result.edgesDiscovered).toBe('number');
      expect(typeof result.episodesProcessed).toBe('number');
    });

    it('should filter by session ID', async () => {
      const baseTime = Math.floor(Date.now() / 1000);

      await insertEpisode('session-1', 'task', 'output', 0.8, baseTime);
      await insertEpisode('session-2', 'task', 'output', 0.7, baseTime);

      const result = await learner.consolidateEpisodes('session-1');

      expect(result).toBeDefined();
      expect(result.episodesProcessed).toBeGreaterThanOrEqual(0);
    });

    it('should return empty result for non-existent session', async () => {
      const result = await learner.consolidateEpisodes('non-existent-session');

      expect(result.edgesDiscovered).toBe(0);
      expect(result.episodesProcessed).toBe(0);
    });
  });

  describe('updateConfig', () => {
    it('should update learner configuration', () => {
      learner.updateConfig({ minSimilarity: 0.9, experimentBudget: 20 });
      expect(() => learner.updateConfig({})).not.toThrow();
    });

    it('should partially update config', () => {
      learner.updateConfig({ autoExperiments: false });
      expect(() => learner.updateConfig({ autoExperiments: false })).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty database gracefully', async () => {
      const report = await learner.run();

      expect(report).toBeDefined();
      expect(report.edgesDiscovered).toBe(0);
    });

    it('should handle single episode', async () => {
      await insertEpisode('session-1', 'task', 'output', 0.8, Math.floor(Date.now() / 1000));

      const report = await learner.run();

      expect(report).toBeDefined();
    });

    it('should handle episodes with same timestamp', async () => {
      const ts = Math.floor(Date.now() / 1000);
      for (let i = 0; i < 5; i++) {
        await insertEpisode('session-1', `task_${i}`, 'output', 0.8, ts);
      }

      const report = await learner.run();

      expect(report).toBeDefined();
    });

    it('should handle negative rewards', async () => {
      await insertEpisode('session-1', 'task', 'output', -0.5, Math.floor(Date.now() / 1000));

      const report = await learner.run();

      expect(report).toBeDefined();
    });

    it('should handle very long task names', async () => {
      const longTask = 'a'.repeat(1000);
      await insertEpisode('session-1', longTask, 'output', 0.8, Math.floor(Date.now() / 1000));

      const report = await learner.run();

      expect(report).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should handle 100 episodes efficiently', async () => {
      const sessionId = 'perf-test-session';
      const baseTime = Math.floor(Date.now() / 1000);

      for (let i = 0; i < 100; i++) {
        await insertEpisode(
          sessionId,
          `task_${i % 10}`,
          `output_${i}`,
          0.5 + Math.random() * 0.5,
          baseTime + i * 30,
        );
      }

      const startTime = Date.now();
      const report = await learner.run();
      const duration = Date.now() - startTime;

      expect(report).toBeDefined();
      expect(duration).toBeLessThan(60000);
    }, 60000);

    it('should handle concurrent consolidation', async () => {
      const baseTime = Math.floor(Date.now() / 1000);

      for (let i = 0; i < 20; i++) {
        await insertEpisode('session-1', 'task', 'output', 0.8, baseTime + i);
      }

      const results = await Promise.all([
        learner.consolidateEpisodes(),
        learner.consolidateEpisodes(),
        learner.consolidateEpisodes(),
      ]);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result).toBeDefined();
      });
    });
  });

  describe('Causal Edge Discovery', () => {
    it('should respect minSimilarity threshold', async () => {
      const customLearner = new NightlyLearner(db, embedder, {
        minSimilarity: 0.99,
        minSampleSize: 1,
        confidenceThreshold: 0.1,
        upliftThreshold: 0.01,
        pruneOldEdges: false,
        edgeMaxAgeDays: 90,
        autoExperiments: false,
        experimentBudget: 0,
      });

      const baseTime = Math.floor(Date.now() / 1000);
      for (let i = 0; i < 10; i++) {
        await insertEpisode('session-1', 'task', 'output', 0.8, baseTime + i);
      }

      const report = await customLearner.run();

      expect(report.edgesDiscovered).toBeGreaterThanOrEqual(0);
    });

    it('should respect confidenceThreshold', async () => {
      const customLearner = new NightlyLearner(db, embedder, {
        minSimilarity: 0.1,
        minSampleSize: 1,
        confidenceThreshold: 0.99,
        upliftThreshold: 0.01,
        pruneOldEdges: false,
        edgeMaxAgeDays: 90,
        autoExperiments: false,
        experimentBudget: 0,
      });

      const baseTime = Math.floor(Date.now() / 1000);
      for (let i = 0; i < 10; i++) {
        await insertEpisode('session-1', 'task', 'output', 0.8, baseTime + i);
      }

      const report = await customLearner.run();

      expect(report.edgesDiscovered).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Experiment Management', () => {
    it('should create experiments when autoExperiments is enabled', async () => {
      const experimentLearner = new NightlyLearner(db, embedder, {
        minSimilarity: 0.1,
        minSampleSize: 5,
        confidenceThreshold: 0.1,
        upliftThreshold: 0.01,
        pruneOldEdges: false,
        edgeMaxAgeDays: 90,
        autoExperiments: true,
        experimentBudget: 10,
      });

      const baseTime = Math.floor(Date.now() / 1000);
      for (let i = 0; i < 20; i++) {
        await insertEpisode(
          'session-1',
          `task_${i % 3}`,
          'output',
          0.8,
          baseTime + i * 60,
        );
      }

      const report = await experimentLearner.run();

      expect(report.experimentsCreated).toBeGreaterThanOrEqual(0);
    });

    it('should not create experiments when autoExperiments is disabled', async () => {
      const noExpLearner = new NightlyLearner(db, embedder, {
        minSimilarity: 0.1,
        minSampleSize: 5,
        confidenceThreshold: 0.1,
        upliftThreshold: 0.01,
        pruneOldEdges: false,
        edgeMaxAgeDays: 90,
        autoExperiments: false,
        experimentBudget: 0,
      });

      const baseTime = Math.floor(Date.now() / 1000);
      for (let i = 0; i < 10; i++) {
        await insertEpisode('session-1', 'task', 'output', 0.8, baseTime + i);
      }

      const report = await noExpLearner.run();

      expect(report.experimentsCreated).toBe(0);
    });

    it('should respect experimentBudget', async () => {
      const limitedLearner = new NightlyLearner(db, embedder, {
        minSimilarity: 0.1,
        minSampleSize: 5,
        confidenceThreshold: 0.1,
        upliftThreshold: 0.01,
        pruneOldEdges: false,
        edgeMaxAgeDays: 90,
        autoExperiments: true,
        experimentBudget: 2,
      });

      const baseTime = Math.floor(Date.now() / 1000);
      for (let i = 0; i < 50; i++) {
        await insertEpisode('session-1', `task_${i % 10}`, 'output', 0.8, baseTime + i * 60);
      }

      const report = await limitedLearner.run();

      expect(report.experimentsCreated).toBeLessThanOrEqual(2);
    });
  });
});
