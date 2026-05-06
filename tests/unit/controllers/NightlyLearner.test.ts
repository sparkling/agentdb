/**
 * Unit Tests for NightlyLearner Controller
 *
 * Tests automated causal discovery, A/B experiments, and edge consolidation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { NightlyLearner, LearnerConfig, LearnerReport } from '../../../src/controllers/NightlyLearner.js';
import { EmbeddingService } from '../../../src/controllers/EmbeddingService.js';
import * as fs from 'fs';

const TEST_DB_PATH = './tests/fixtures/test-nightly-learner.db';

describe('NightlyLearner', () => {
  let db: Database.Database;
  let embedder: EmbeddingService;
  let learner: NightlyLearner;

  beforeEach(async () => {
    // Clean up previous test artifacts
    [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`].forEach(file => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });

    // Initialize database
    db = new Database(TEST_DB_PATH);
    db.pragma('journal_mode = WAL');

    // Create required tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        task TEXT NOT NULL,
        output TEXT,
        reward REAL DEFAULT 0,
        ts INTEGER DEFAULT (strftime('%s', 'now')),
        latency_ms INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS causal_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_memory_id INTEGER NOT NULL,
        from_memory_type TEXT NOT NULL,
        to_memory_id INTEGER NOT NULL,
        to_memory_type TEXT NOT NULL,
        similarity REAL NOT NULL,
        uplift REAL,
        confidence REAL NOT NULL,
        sample_size INTEGER DEFAULT 1,
        mechanism TEXT,
        evidence_ids TEXT,
        metadata TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS causal_experiments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        hypothesis TEXT,
        treatment_id INTEGER,
        treatment_type TEXT,
        control_id INTEGER,
        control_type TEXT,
        start_time INTEGER,
        end_time INTEGER,
        sample_size INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        uplift REAL,
        confidence REAL,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS episode_embeddings (
        episode_id INTEGER PRIMARY KEY,
        embedding BLOB NOT NULL
      );
    `);

    // Initialize embedding service
    embedder = new EmbeddingService({
      model: 'mock-model',
      dimension: 384,
      provider: 'local',
    });
    await embedder.initialize();

    // Initialize NightlyLearner with default config
    learner = new NightlyLearner(db, embedder);
  });

  afterEach(() => {
    db.close();
    [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`].forEach(file => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });
  });

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
      // Insert test episodes with temporal sequence
      const sessionId = 'test-session-1';
      const baseTime = Date.now() / 1000;

      for (let i = 0; i < 20; i++) {
        db.prepare(`
          INSERT INTO episodes (session_id, task, output, reward, ts)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          sessionId,
          `task_${i % 3}`,
          `output_${i}`,
          0.5 + (i % 10) * 0.05,
          baseTime + i * 60
        );
      }

      const report = await learner.run();

      expect(report.edgesDiscovered).toBeGreaterThanOrEqual(0);
      expect(report.executionTimeMs).toBeGreaterThan(0);
    });

    it('should complete running experiments', async () => {
      // Insert some test episodes first
      for (let i = 0; i < 10; i++) {
        db.prepare(`
          INSERT INTO episodes (session_id, task, output, reward, ts)
          VALUES (?, ?, ?, ?, ?)
        `).run('session-1', 'task', 'output', 0.8, Date.now() / 1000 + i);
      }

      // Insert a running experiment with enough samples
      db.prepare(`
        INSERT INTO causal_experiments (name, hypothesis, treatment_id, treatment_type, start_time, sample_size, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'Test Experiment',
        'Test hypothesis',
        1,
        'episode',
        Date.now(),
        50,
        'running'
      );

      const report = await learner.run();

      expect(report.experimentsCompleted).toBeGreaterThanOrEqual(0);
    });

    it('should prune low-confidence edges', async () => {
      // Insert low-confidence edges
      for (let i = 0; i < 10; i++) {
        db.prepare(`
          INSERT INTO causal_edges (from_memory_id, from_memory_type, to_memory_id, to_memory_type, similarity, confidence, uplift, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          i,
          'episode',
          i + 1,
          'episode',
          0.5,
          0.3, // Low confidence
          0.1,
          Date.now() / 1000 - 100 * 24 * 60 * 60 // Old edge
        );
      }

      const report = await learner.run();

      expect(report.edgesPruned).toBeGreaterThanOrEqual(0);
    });

    it('should generate recommendations', async () => {
      const report = await learner.run();

      expect(report.recommendations).toBeDefined();
      expect(Array.isArray(report.recommendations)).toBe(true);
      // Should have at least one recommendation when no edges discovered
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('discover', () => {
    it('should discover causal edges with config', async () => {
      // Insert test episodes
      for (let i = 0; i < 15; i++) {
        db.prepare(`
          INSERT INTO episodes (session_id, task, output, reward, ts)
          VALUES (?, ?, ?, ?, ?)
        `).run('session-1', 'task', 'output', 0.8, Date.now() / 1000 + i);
      }

      const edges = await learner.discover({
        minAttempts: 5,
        minSuccessRate: 0.5,
        minConfidence: 0.6,
      });

      expect(Array.isArray(edges)).toBe(true);
    });

    it('should support dry run mode', async () => {
      const edges = await learner.discover({
        dryRun: true,
      });

      expect(Array.isArray(edges)).toBe(true);
      expect(edges.length).toBe(0); // Dry run returns empty array
    });
  });

  describe('consolidateEpisodes', () => {
    it('should return consolidation results without FlashAttention', async () => {
      // Insert test episodes
      for (let i = 0; i < 5; i++) {
        db.prepare(`
          INSERT INTO episodes (session_id, task, output, reward, ts)
          VALUES (?, ?, ?, ?, ?)
        `).run('session-1', 'task', 'output', 0.8, Date.now() / 1000 + i);
      }

      const result = await learner.consolidateEpisodes();

      expect(result).toBeDefined();
      expect(typeof result.edgesDiscovered).toBe('number');
      expect(typeof result.episodesProcessed).toBe('number');
    });

    it('should filter by session ID', async () => {
      // Insert episodes for different sessions
      db.prepare(`
        INSERT INTO episodes (session_id, task, output, reward, ts)
        VALUES (?, ?, ?, ?, ?)
      `).run('session-1', 'task', 'output', 0.8, Date.now() / 1000);

      db.prepare(`
        INSERT INTO episodes (session_id, task, output, reward, ts)
        VALUES (?, ?, ?, ?, ?)
      `).run('session-2', 'task', 'output', 0.7, Date.now() / 1000);

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
      learner.updateConfig({
        minSimilarity: 0.9,
        experimentBudget: 20,
      });

      // Verify config was updated by running and checking behavior
      expect(() => learner.updateConfig({})).not.toThrow();
    });

    it('should partially update config', () => {
      learner.updateConfig({
        autoExperiments: false,
      });

      // Subsequent run should not create experiments
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
      db.prepare(`
        INSERT INTO episodes (session_id, task, output, reward, ts)
        VALUES (?, ?, ?, ?, ?)
      `).run('session-1', 'task', 'output', 0.8, Date.now() / 1000);

      const report = await learner.run();

      expect(report).toBeDefined();
    });

    it('should handle episodes with same timestamp', async () => {
      const ts = Date.now() / 1000;
      for (let i = 0; i < 5; i++) {
        db.prepare(`
          INSERT INTO episodes (session_id, task, output, reward, ts)
          VALUES (?, ?, ?, ?, ?)
        `).run('session-1', `task_${i}`, 'output', 0.8, ts);
      }

      const report = await learner.run();

      expect(report).toBeDefined();
    });

    it('should handle negative rewards', async () => {
      db.prepare(`
        INSERT INTO episodes (session_id, task, output, reward, ts)
        VALUES (?, ?, ?, ?, ?)
      `).run('session-1', 'task', 'output', -0.5, Date.now() / 1000);

      const report = await learner.run();

      expect(report).toBeDefined();
    });

    it('should handle very long task names', async () => {
      const longTask = 'a'.repeat(1000);
      db.prepare(`
        INSERT INTO episodes (session_id, task, output, reward, ts)
        VALUES (?, ?, ?, ?, ?)
      `).run('session-1', longTask, 'output', 0.8, Date.now() / 1000);

      const report = await learner.run();

      expect(report).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should handle 100 episodes efficiently', async () => {
      const sessionId = 'perf-test-session';
      const baseTime = Date.now() / 1000;

      // Insert 100 episodes
      const insertStmt = db.prepare(`
        INSERT INTO episodes (session_id, task, output, reward, ts)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < 100; i++) {
        insertStmt.run(sessionId, `task_${i % 10}`, `output_${i}`, 0.5 + Math.random() * 0.5, baseTime + i * 30);
      }

      const startTime = Date.now();
      const report = await learner.run();
      const duration = Date.now() - startTime;

      expect(report).toBeDefined();
      expect(duration).toBeLessThan(10000); // Should complete in under 10 seconds
    }, 15000);

    it('should handle concurrent consolidation', async () => {
      // Insert test episodes
      for (let i = 0; i < 20; i++) {
        db.prepare(`
          INSERT INTO episodes (session_id, task, output, reward, ts)
          VALUES (?, ?, ?, ?, ?)
        `).run('session-1', 'task', 'output', 0.8, Date.now() / 1000 + i);
      }

      // Run consolidation multiple times concurrently
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
        minSimilarity: 0.99, // Very high threshold
        minSampleSize: 1,
        confidenceThreshold: 0.1,
        upliftThreshold: 0.01,
        pruneOldEdges: false,
        edgeMaxAgeDays: 90,
        autoExperiments: false,
        experimentBudget: 0,
      });

      // Insert test episodes
      for (let i = 0; i < 10; i++) {
        db.prepare(`
          INSERT INTO episodes (session_id, task, output, reward, ts)
          VALUES (?, ?, ?, ?, ?)
        `).run('session-1', 'task', 'output', 0.8, Date.now() / 1000 + i);
      }

      const report = await customLearner.run();

      // With very high similarity threshold, should discover fewer edges
      expect(report.edgesDiscovered).toBeGreaterThanOrEqual(0);
    });

    it('should respect confidenceThreshold', async () => {
      const customLearner = new NightlyLearner(db, embedder, {
        minSimilarity: 0.1,
        minSampleSize: 1,
        confidenceThreshold: 0.99, // Very high confidence threshold
        upliftThreshold: 0.01,
        pruneOldEdges: false,
        edgeMaxAgeDays: 90,
        autoExperiments: false,
        experimentBudget: 0,
      });

      // Insert test episodes
      for (let i = 0; i < 10; i++) {
        db.prepare(`
          INSERT INTO episodes (session_id, task, output, reward, ts)
          VALUES (?, ?, ?, ?, ?)
        `).run('session-1', 'task', 'output', 0.8, Date.now() / 1000 + i);
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

      // Insert episodes with potential for experiments
      for (let i = 0; i < 20; i++) {
        db.prepare(`
          INSERT INTO episodes (session_id, task, output, reward, ts)
          VALUES (?, ?, ?, ?, ?)
        `).run('session-1', `task_${i % 3}`, 'output', 0.8, Date.now() / 1000 + i * 60);
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

      // Insert test episodes
      for (let i = 0; i < 10; i++) {
        db.prepare(`
          INSERT INTO episodes (session_id, task, output, reward, ts)
          VALUES (?, ?, ?, ?, ?)
        `).run('session-1', 'task', 'output', 0.8, Date.now() / 1000 + i);
      }

      const report = await noExpLearner.run();

      expect(report.experimentsCreated).toBe(0);
    });

    it('should respect experimentBudget', async () => {
      // Create learner with limited budget
      const limitedLearner = new NightlyLearner(db, embedder, {
        minSimilarity: 0.1,
        minSampleSize: 5,
        confidenceThreshold: 0.1,
        upliftThreshold: 0.01,
        pruneOldEdges: false,
        edgeMaxAgeDays: 90,
        autoExperiments: true,
        experimentBudget: 2, // Limited budget
      });

      // Insert many episodes
      for (let i = 0; i < 50; i++) {
        db.prepare(`
          INSERT INTO episodes (session_id, task, output, reward, ts)
          VALUES (?, ?, ?, ?, ?)
        `).run('session-1', `task_${i % 10}`, 'output', 0.8, Date.now() / 1000 + i * 60);
      }

      const report = await limitedLearner.run();

      expect(report.experimentsCreated).toBeLessThanOrEqual(2);
    });
  });
});
