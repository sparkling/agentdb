/**
 * Unit Tests for LearningSystem Controller
 *
 * Tests reinforcement learning session management, action prediction, and policy training.
 *
 * ADR-0170 Phase B.6: ported from better-sqlite3 to PostgresBackend
 * (pglite-embedded). Each test gets a fresh ephemeral pglite cluster
 * under `os.tmpdir()`; the singleton-cache is reset between tests so
 * sequential specs each construct against their own backend.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LearningSystem, ActionFeedback } from '../../../src/controllers/LearningSystem.js';
import { EmbeddingService } from '../../../src/controllers/EmbeddingService.js';
import { PostgresBackend } from '../../../src/backends/postgres/PostgresBackend.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('LearningSystem', () => {
  let backend: PostgresBackend;
  let embedder: EmbeddingService;
  let learning: LearningSystem;
  let dataDir: string;

  beforeEach(async () => {
    LearningSystem._resetSingleton();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-system-test-'));

    backend = new PostgresBackend({ metric: 'cosine', dataDir });
    await backend.initialize();

    embedder = new EmbeddingService({
      model: 'mock-model',
      dimension: 384,
      provider: 'local',
    });
    await embedder.initialize();

    learning = new LearningSystem(backend, embedder);
  });

  afterEach(async () => {
    try {
      backend.close();
    } catch {
      /* best-effort */
    }
    // pglite's WASM teardown can issue deferred FS writes after close()
    // returns; await a microtask + a tiny tick so the rmSync below doesn't
    // race the cluster's flush and trip ErrnoError(44) as an unhandled
    // rejection. The Edge-Cases specs (which embed many states in a single
    // session) exacerbate this; the settle delay keeps the suite clean.
    await new Promise((resolve) => setTimeout(resolve, 100));
    LearningSystem._resetSingleton();
    try {
      if (dataDir && fs.existsSync(dataDir)) {
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    } catch {
      /* best-effort */
    }
  });

  describe('startSession', () => {
    it('should start Q-learning session', async () => {
      const sessionId = await learning.startSession('user-1', 'q-learning', {
        learningRate: 0.1,
        discountFactor: 0.9,
        explorationRate: 0.2,
      });

      expect(sessionId).toBeTruthy();
      expect(sessionId).toContain('session-');
    });

    it('should start SARSA session', async () => {
      const sessionId = await learning.startSession('user-1', 'sarsa', {
        learningRate: 0.05,
        discountFactor: 0.95,
      });

      expect(sessionId).toBeTruthy();
    });

    it('should start DQN session', async () => {
      const sessionId = await learning.startSession('user-1', 'dqn', {
        learningRate: 0.001,
        discountFactor: 0.99,
        batchSize: 32,
        targetUpdateFrequency: 100,
      });

      expect(sessionId).toBeTruthy();
    });

    it('should start policy gradient session', async () => {
      const sessionId = await learning.startSession('user-1', 'policy-gradient', {
        learningRate: 0.01,
        discountFactor: 0.9,
      });

      expect(sessionId).toBeTruthy();
    });

    it('should store session in database', async () => {
      const sessionId = await learning.startSession('user-1', 'q-learning', {
        learningRate: 0.1,
        discountFactor: 0.9,
      });

      const result = await backend.query('SELECT * FROM learning_sessions WHERE id = $1', [sessionId]);
      const session = result.rows[0];

      expect(session).toBeDefined();
    });
  });

  describe('endSession', () => {
    it('should end active session', async () => {
      const sessionId = await learning.startSession('user-1', 'q-learning', {
        learningRate: 0.1,
        discountFactor: 0.9,
      });

      await learning.endSession(sessionId);

      const result = await backend.query('SELECT * FROM learning_sessions WHERE id = $1', [sessionId]);
      const session = result.rows[0] as any;

      expect(session.status).toBe('completed');
      expect(session.end_time).toBeDefined();
    });

    it('should throw error for non-existent session', async () => {
      await expect(learning.endSession('non-existent-session')).rejects.toThrow();
    });

    it('should throw error for already completed session', async () => {
      const sessionId = await learning.startSession('user-1', 'q-learning', {
        learningRate: 0.1,
        discountFactor: 0.9,
      });

      await learning.endSession(sessionId);

      await expect(learning.endSession(sessionId)).rejects.toThrow();
    });
  });

  describe('predict', () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = await learning.startSession('user-1', 'q-learning', {
        learningRate: 0.1,
        discountFactor: 0.9,
        explorationRate: 0.1,
      });

      // Add some training data
      for (let i = 0; i < 10; i++) {
        await learning.submitFeedback({
          sessionId,
          action: `action_${i % 3}`,
          state: 'test_state',
          reward: Math.random(),
          success: Math.random() > 0.5,
          timestamp: Date.now(),
        });
      }
    });

    it('should predict action with confidence scores', async () => {
      const prediction = await learning.predict(sessionId, 'test_state');

      expect(prediction).toBeDefined();
      expect(prediction.action).toBeTruthy();
      expect(prediction.confidence).toBeGreaterThanOrEqual(0);
      expect(prediction.confidence).toBeLessThanOrEqual(1);
      expect(prediction.alternatives).toBeInstanceOf(Array);
    });

    it('should return Q-value for Q-learning', async () => {
      const prediction = await learning.predict(sessionId, 'test_state');

      expect(prediction.qValue).toBeDefined();
      expect(typeof prediction.qValue).toBe('number');
    });

    it('should throw error for non-active session', async () => {
      await learning.endSession(sessionId);

      await expect(learning.predict(sessionId, 'test_state')).rejects.toThrow();
    });
  });

  describe('submitFeedback', () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = await learning.startSession('user-1', 'q-learning', {
        learningRate: 0.1,
        discountFactor: 0.9,
      });
    });

    it('should submit successful feedback', async () => {
      const feedback: ActionFeedback = {
        sessionId,
        action: 'action_1',
        state: 'state_1',
        reward: 0.8,
        nextState: 'state_2',
        success: true,
        timestamp: Date.now(),
      };

      await expect(learning.submitFeedback(feedback)).resolves.not.toThrow();
    });

    it('should submit failure feedback', async () => {
      const feedback: ActionFeedback = {
        sessionId,
        action: 'action_1',
        state: 'state_1',
        reward: 0.2,
        success: false,
        timestamp: Date.now(),
      };

      await expect(learning.submitFeedback(feedback)).resolves.not.toThrow();
    });

    it('should store experience in database', async () => {
      const feedback: ActionFeedback = {
        sessionId,
        action: 'action_1',
        state: 'state_1',
        reward: 0.8,
        success: true,
        timestamp: Date.now(),
      };

      await learning.submitFeedback(feedback);

      const result = await backend.query(
        'SELECT * FROM learning_experiences WHERE session_id = $1',
        [sessionId],
      );

      expect(result.rows.length).toBe(1);
    });
  });

  describe('train', () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = await learning.startSession('user-1', 'q-learning', {
        learningRate: 0.1,
        discountFactor: 0.9,
      });

      // Add training data
      for (let i = 0; i < 20; i++) {
        await learning.submitFeedback({
          sessionId,
          action: `action_${i % 3}`,
          state: `state_${i % 5}`,
          reward: 0.5 + Math.random() * 0.3,
          nextState: `state_${(i % 5) + 1}`,
          success: true,
          timestamp: Date.now() + i,
        });
      }
    });

    it('should train policy with batch learning', async () => {
      const result = await learning.train(sessionId, 5, 4, 0.01);

      expect(result.epochsCompleted).toBe(5);
      expect(result.finalLoss).toBeGreaterThanOrEqual(0);
      expect(result.avgReward).toBeGreaterThanOrEqual(0);
      expect(result.convergenceRate).toBeGreaterThanOrEqual(0);
      expect(result.convergenceRate).toBeLessThanOrEqual(1);
      expect(result.trainingTimeMs).toBeGreaterThan(0);
    }, 10000);

    it('should improve policy over epochs', async () => {
      const result = await learning.train(sessionId, 10, 5, 0.1);

      expect(result.epochsCompleted).toBe(10);
      expect(result.finalLoss).toBeGreaterThanOrEqual(0);
    }, 10000);

    it('should throw error when no training data exists', async () => {
      const emptySessionId = await learning.startSession('user-2', 'q-learning', {
        learningRate: 0.1,
        discountFactor: 0.9,
      });

      await expect(learning.train(emptySessionId, 5, 4, 0.01)).rejects.toThrow();
    });
  });

  describe('getMetrics', () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = await learning.startSession('user-1', 'q-learning', {
        learningRate: 0.1,
        discountFactor: 0.9,
      });

      // Add training data
      for (let i = 0; i < 15; i++) {
        await learning.submitFeedback({
          sessionId,
          action: `action_${i % 3}`,
          state: `state_${i % 5}`,
          reward: 0.6 + Math.random() * 0.3,
          success: i > 5,
          timestamp: Date.now() + i * 1000,
        });
      }
    });

    it('should get overall metrics', async () => {
      const metrics = await learning.getMetrics({
        sessionId,
        timeWindowDays: 7,
      });

      expect(metrics.overall).toBeDefined();
      expect(metrics.overall.totalEpisodes).toBeGreaterThan(0);
      expect(metrics.overall.avgReward).toBeGreaterThanOrEqual(0);
      expect(metrics.overall.successRate).toBeGreaterThanOrEqual(0);
      expect(metrics.overall.successRate).toBeLessThanOrEqual(1);
    });

    it('should include trends when requested', async () => {
      const metrics = await learning.getMetrics({
        sessionId,
        includeTrends: true,
      });

      expect(metrics.trends).toBeInstanceOf(Array);
    });

    it('should group metrics by task', async () => {
      const metrics = await learning.getMetrics({
        groupBy: 'task',
      });

      expect(metrics.groupedMetrics).toBeInstanceOf(Array);
    });
  });

  describe('calculateReward', () => {
    it('should calculate standard reward', async () => {
      const reward = await learning.calculateReward({
        success: true,
        targetAchieved: true,
        qualityScore: 0.8,
        efficiencyScore: 0.9,
        rewardFunction: 'standard',
      });

      expect(reward).toBeGreaterThanOrEqual(0);
      expect(reward).toBeLessThanOrEqual(1);
    });

    it('should calculate sparse reward', async () => {
      const successReward = await learning.calculateReward({
        success: true,
        targetAchieved: true,
        rewardFunction: 'sparse',
      });

      const failureReward = await learning.calculateReward({
        success: false,
        targetAchieved: false,
        rewardFunction: 'sparse',
      });

      expect(successReward).toBe(1.0);
      expect(failureReward).toBe(0.0);
    });

    it('should calculate dense reward with partial progress', async () => {
      const reward = await learning.calculateReward({
        success: true,
        targetAchieved: false,
        qualityScore: 0.7,
        efficiencyScore: 0.6,
        rewardFunction: 'dense',
      });

      expect(reward).toBeGreaterThan(0);
      expect(reward).toBeLessThan(2);
    });

    it('should calculate shaped reward with time bonus', async () => {
      const reward = await learning.calculateReward({
        success: true,
        targetAchieved: true,
        timeTakenMs: 500,
        expectedTimeMs: 1000,
        qualityScore: 0.8,
        efficiencyScore: 0.9,
        rewardFunction: 'shaped',
      });

      expect(reward).toBeGreaterThanOrEqual(0);
      expect(reward).toBeLessThanOrEqual(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty state string', async () => {
      const sessionId = await learning.startSession('user-1', 'q-learning', {
        learningRate: 0.1,
        discountFactor: 0.9,
      });

      await learning.submitFeedback({
        sessionId,
        action: 'action',
        state: '',
        reward: 0.5,
        success: true,
        timestamp: Date.now(),
      });

      const prediction = await learning.predict(sessionId, '');

      expect(prediction).toBeDefined();
    });

    it('should handle very long state strings', async () => {
      const sessionId = await learning.startSession('user-1', 'q-learning', {
        learningRate: 0.1,
        discountFactor: 0.9,
      });

      const longState = 'a'.repeat(1000);

      await learning.submitFeedback({
        sessionId,
        action: 'action',
        state: longState,
        reward: 0.5,
        success: true,
        timestamp: Date.now(),
      });

      const prediction = await learning.predict(sessionId, longState);

      expect(prediction).toBeDefined();
    });

    it('should handle zero reward', async () => {
      const sessionId = await learning.startSession('user-1', 'q-learning', {
        learningRate: 0.1,
        discountFactor: 0.9,
      });

      await expect(learning.submitFeedback({
        sessionId,
        action: 'action',
        state: 'state',
        reward: 0.0,
        success: false,
        timestamp: Date.now(),
      })).resolves.not.toThrow();
    });

    it('should handle negative reward', async () => {
      const sessionId = await learning.startSession('user-1', 'q-learning', {
        learningRate: 0.1,
        discountFactor: 0.9,
      });

      await expect(learning.submitFeedback({
        sessionId,
        action: 'action',
        state: 'state',
        reward: -0.5,
        success: false,
        timestamp: Date.now(),
      })).resolves.not.toThrow();
    });
  });

  describe('Performance', () => {
    it('should handle 100 feedback submissions efficiently', async () => {
      const sessionId = await learning.startSession('user-1', 'q-learning', {
        learningRate: 0.1,
        discountFactor: 0.9,
      });

      const startTime = Date.now();

      for (let i = 0; i < 100; i++) {
        await learning.submitFeedback({
          sessionId,
          action: `action_${i % 5}`,
          state: `state_${i % 10}`,
          reward: Math.random(),
          success: Math.random() > 0.5,
          timestamp: Date.now() + i,
        });
      }

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(5000); // Should complete in less than 5 seconds (pglite slightly slower than sqlite)
    }, 10000);
  });
});
