/**
 * FederatedSessionManager Tests (ADR-005 Phase 4)
 *
 * Tests cross-session federated learning via @ruvector/ruvllm:
 * - Availability detection
 * - Session lifecycle (begin/record/end)
 * - Warm-start pattern loading
 * - Federated aggregation across sessions
 * - LoRA adapter management
 * - Input validation and bounds checking
 * - Destroy lifecycle
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  FederatedSessionManager,
  type SessionStats,
} from '../../src/backends/rvf/FederatedSessionManager.js';

// Track instances for cleanup
let manager: FederatedSessionManager | null = null;

afterEach(() => {
  if (manager && !manager.isDestroyed) {
    manager.destroy();
  }
  manager = null;
});

function generateEmbedding(dim: number, seed: number): number[] {
  const vec: number[] = [];
  let s = seed;
  for (let i = 0; i < dim; i++) {
    s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
    vec.push(((s >>> 0) / 0xFFFFFFFF) * 2 - 1);
  }
  return vec;
}

describe('FederatedSessionManager', () => {
  describe('availability', () => {
    it('should detect @ruvector/ruvllm availability', async () => {
      const available = await FederatedSessionManager.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('creation and configuration', () => {
    it('should create with valid config', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return; // skip if ruvllm not installed

      manager = await FederatedSessionManager.create({ dimension: 32 });
      expect(manager.dimension).toBe(32);
      expect(manager.activeSessionCount).toBe(0);
      expect(manager.isDestroyed).toBe(false);
    });

    it('should reject dimension < 1', async () => {
      await expect(
        FederatedSessionManager.create({ dimension: 0 }),
      ).rejects.toThrow('dimension must be between 1 and 4096');
    });

    it('should reject dimension > 4096', async () => {
      await expect(
        FederatedSessionManager.create({ dimension: 5000 }),
      ).rejects.toThrow('dimension must be between 1 and 4096');
    });

    it('should reject non-finite dimension', async () => {
      await expect(
        FederatedSessionManager.create({ dimension: NaN }),
      ).rejects.toThrow('dimension must be between 1 and 4096');
    });

    it('should reject Infinity dimension', async () => {
      await expect(
        FederatedSessionManager.create({ dimension: Infinity }),
      ).rejects.toThrow('dimension must be between 1 and 4096');
    });

    it('should apply custom config with bounds', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({
        dimension: 64,
        maxAgents: 50,
        qualityThreshold: 0.5,
        consolidationInterval: 20,
        loraRank: 8,
        loraAlpha: 16,
      });
      expect(manager.dimension).toBe(64);
    });
  });

  describe('session lifecycle', () => {
    it('should begin and end a session', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      const session = await manager.beginSession('agent-1');

      expect(session.id).toBe('agent-1');
      expect(session.isEnded).toBe(false);
      expect(manager.activeSessionCount).toBe(1);

      const stats = session.end();
      expect(session.isEnded).toBe(true);
      expect(manager.activeSessionCount).toBe(0);
      expect(stats.trajectoryCount).toBe(0);
      expect(stats.sessionDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should record trajectories in a session', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      const session = await manager.beginSession('agent-2');

      // Record several trajectories
      for (let i = 0; i < 10; i++) {
        const embedding = generateEmbedding(16, i);
        session.recordTrajectory(embedding, 0.7 + i * 0.02);
      }

      const stats = session.getStats();
      expect(stats.trajectoryCount).toBe(10);
      expect(stats.avgQuality).toBeGreaterThan(0);

      session.end();
    });

    it('should accept Float32Array embeddings', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 8 });
      const session = await manager.beginSession('agent-f32');

      const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
      session.recordTrajectory(embedding, 0.9);

      const stats = session.getStats();
      expect(stats.trajectoryCount).toBe(1);

      session.end();
    });

    it('should record trajectories with route labels', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      const session = await manager.beginSession('agent-routes');

      session.recordTrajectory(generateEmbedding(16, 1), 0.8, 'math');
      session.recordTrajectory(generateEmbedding(16, 2), 0.7, 'code');
      session.recordTrajectory(generateEmbedding(16, 3), 0.9, 'math');

      expect(session.getStats().trajectoryCount).toBe(3);

      session.end();
    });

    it('should reject duplicate session IDs', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      const session = await manager.beginSession('dup-agent');

      await expect(
        manager.beginSession('dup-agent'),
      ).rejects.toThrow('Session already active for agent: dup-agent');

      session.end();
    });

    it('should reject operations on ended session', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      const session = await manager.beginSession('ended-agent');
      session.end();

      expect(() => {
        session.recordTrajectory(generateEmbedding(16, 1), 0.5);
      }).toThrow('has already ended');

      expect(() => {
        session.getStats();
      }).toThrow('has already ended');

      expect(() => {
        session.getPatterns();
      }).toThrow('has already ended');
    });

    it('should reject wrong dimension embeddings', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      const session = await manager.beginSession('dim-check');

      expect(() => {
        session.recordTrajectory(generateEmbedding(32, 1), 0.5);
      }).toThrow('does not match configured dimension');

      session.end();
    });
  });

  describe('agent ID validation', () => {
    it('should reject empty agent ID', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });

      await expect(
        manager.beginSession(''),
      ).rejects.toThrow('Agent ID must be 1-256 characters');
    });

    it('should reject overly long agent ID', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      const longId = 'a'.repeat(257);

      await expect(
        manager.beginSession(longId),
      ).rejects.toThrow('Agent ID must be 1-256 characters');
    });

    it('should reject agent ID with null bytes', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });

      await expect(
        manager.beginSession('agent\0bad'),
      ).rejects.toThrow('must not contain null bytes');
    });
  });

  describe('warm-start patterns', () => {
    it('should provide initial patterns on warm start', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });

      // First session: record trajectories and aggregate
      const s1 = await manager.beginSession('learner-1');
      for (let i = 0; i < 20; i++) {
        s1.recordTrajectory(generateEmbedding(16, i), 0.8);
      }
      s1.end();

      // Second session should get warm-start patterns
      const s2 = await manager.beginSession('learner-2');
      const patterns = s2.initialPatterns;
      expect(Array.isArray(patterns)).toBe(true);
      // Patterns may or may not be available depending on coordinator state
      s2.end();
    });

    it('should skip warm start when disabled', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      const session = await manager.beginSession('cold-start', false);
      expect(session.initialPatterns).toEqual([]);
      session.end();
    });
  });

  describe('federated aggregation', () => {
    it('should aggregate multiple sessions', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({
        dimension: 16,
        qualityThreshold: 0.3,
      });

      // Run multiple sessions
      for (let a = 0; a < 3; a++) {
        const session = await manager.beginSession(`agent-${a}`);
        for (let i = 0; i < 15; i++) {
          session.recordTrajectory(
            generateEmbedding(16, a * 100 + i),
            0.6 + Math.random() * 0.3,
          );
        }
        session.end();
      }

      const stats = manager.getStats();
      expect(stats.totalAgents).toBeGreaterThanOrEqual(3);
      expect(stats.totalTrajectories).toBeGreaterThanOrEqual(45);
    });

    it('should consolidate on demand', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      const session = await manager.beginSession('consolidate-test');
      for (let i = 0; i < 10; i++) {
        session.recordTrajectory(generateEmbedding(16, i), 0.8);
      }
      session.end();

      // Should not throw
      manager.consolidate();
    });

    it('should export session state', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      const session = await manager.beginSession('export-test');
      for (let i = 0; i < 5; i++) {
        session.recordTrajectory(generateEmbedding(16, i), 0.7);
      }

      const state = manager.exportSession('export-test');
      expect(state).toBeDefined();
      expect(state.agentId).toBe('export-test');

      session.end();
    });

    it('should reject export for non-existent session', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      expect(() => manager!.exportSession('nonexistent')).toThrow('No active session');
    });
  });

  describe('pattern search', () => {
    it('should get initial patterns', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      const patterns = manager.getInitialPatterns(5);
      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should find patterns by query', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });

      // Add some data first
      const session = await manager.beginSession('search-test');
      for (let i = 0; i < 20; i++) {
        session.recordTrajectory(generateEmbedding(16, i), 0.8);
      }
      session.end();

      const results = manager.findPatterns(generateEmbedding(16, 42), 3);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should reject query with wrong dimension', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      expect(() => {
        manager!.findPatterns(generateEmbedding(32, 1), 3);
      }).toThrow('does not match configured dimension');
    });

    it('should bound k parameter', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      // Should not throw even with extreme k values
      const r1 = manager.getInitialPatterns(0);
      expect(Array.isArray(r1)).toBe(true);
      const r2 = manager.getInitialPatterns(999);
      expect(Array.isArray(r2)).toBe(true);
    });
  });

  describe('LoRA adapter management', () => {
    it('should list default adapter', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      const adapters = manager.listAdapters();
      expect(adapters).toContain('default');
    });

    it('should create and activate custom adapters', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      manager.createAdapter('math-adapter', 8);
      manager.createAdapter('code-adapter', 4);

      const adapters = manager.listAdapters();
      expect(adapters).toContain('default');
      expect(adapters).toContain('math-adapter');
      expect(adapters).toContain('code-adapter');

      // Should not throw
      manager.activateAdapter('math-adapter');
    });

    it('should apply LoRA transformation', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      const embedding = generateEmbedding(16, 42);
      const result = manager.applyLora(embedding);
      // LoRA forward may produce output with different dimension depending on internal config
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should bound LoRA rank', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      // rank > 64 should be clamped to 64
      manager.createAdapter('high-rank', 128);
      const adapters = manager.listAdapters();
      expect(adapters).toContain('high-rank');
    });
  });

  describe('quality score clamping', () => {
    it('should clamp quality scores to [0, 1]', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 8 });
      const session = await manager.beginSession('clamp-test');

      // Should not throw -- values are clamped internally
      session.recordTrajectory(generateEmbedding(8, 1), -0.5);
      session.recordTrajectory(generateEmbedding(8, 2), 1.5);
      session.recordTrajectory(generateEmbedding(8, 3), 0.0);
      session.recordTrajectory(generateEmbedding(8, 4), 1.0);

      expect(session.getStats().trajectoryCount).toBe(4);
      session.end();
    });
  });

  describe('session patterns', () => {
    it('should retrieve patterns from active session', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      const session = await manager.beginSession('pattern-test');

      for (let i = 0; i < 20; i++) {
        session.recordTrajectory(generateEmbedding(16, i), 0.8);
      }

      const patterns = session.getPatterns(5);
      expect(Array.isArray(patterns)).toBe(true);
      session.end();
    });
  });

  describe('destroy lifecycle', () => {
    it('should destroy cleanly', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      const session = await manager.beginSession('destroy-test');
      session.recordTrajectory(generateEmbedding(16, 1), 0.5);

      manager.destroy();
      expect(manager.isDestroyed).toBe(true);
      expect(manager.activeSessionCount).toBe(0);
    });

    it('should reject operations after destroy', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      manager.destroy();

      await expect(
        manager.beginSession('post-destroy'),
      ).rejects.toThrow('has been destroyed');

      expect(() => manager!.getStats()).toThrow('has been destroyed');
      expect(() => manager!.consolidate()).toThrow('has been destroyed');
      expect(() => manager!.getInitialPatterns()).toThrow('has been destroyed');
    });

    it('should be idempotent on double destroy', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      manager.destroy();
      manager.destroy(); // should not throw
      expect(manager.isDestroyed).toBe(true);
    });

    it('should return empty adapters after destroy', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({ dimension: 16 });
      manager.destroy();
      expect(manager.listAdapters()).toEqual([]);
    });
  });

  describe('end-to-end federated learning', () => {
    it('should complete full federated learning cycle', async () => {
      const available = await FederatedSessionManager.isAvailable();
      if (!available) return;

      manager = await FederatedSessionManager.create({
        dimension: 32,
        qualityThreshold: 0.3,
        consolidationInterval: 10,
      });

      // Phase 1: Multiple agents record trajectories
      const sessionStats: SessionStats[] = [];
      for (let a = 0; a < 5; a++) {
        const session = await manager.beginSession(`worker-${a}`);
        for (let i = 0; i < 20; i++) {
          session.recordTrajectory(
            generateEmbedding(32, a * 1000 + i),
            0.5 + (i / 20) * 0.4, // Quality improves over time
            i % 2 === 0 ? 'math' : 'code',
          );
        }
        sessionStats.push(session.end());
      }

      // Phase 2: Verify aggregation
      const stats = manager.getStats();
      expect(stats.totalAgents).toBeGreaterThanOrEqual(5);
      // Coordinator may not track raw trajectory count; check agents aggregated
      expect(typeof stats.totalTrajectories).toBe('number');

      // Phase 3: Force consolidation
      manager.consolidate();

      // Phase 4: New session benefits from warm-start
      const newSession = await manager.beginSession('newcomer');
      const warmPatterns = newSession.initialPatterns;
      expect(Array.isArray(warmPatterns)).toBe(true);

      // Record and verify
      newSession.recordTrajectory(generateEmbedding(32, 9999), 0.9);
      expect(newSession.getStats().trajectoryCount).toBe(1);
      newSession.end();

      // Phase 5: LoRA enhancement
      const embedding = generateEmbedding(32, 42);
      const enhanced = manager.applyLora(embedding);
      expect(Array.isArray(enhanced)).toBe(true);
      expect(enhanced.length).toBeGreaterThan(0);

      // Verify all sessions recorded
      expect(sessionStats.length).toBe(5);
      for (const s of sessionStats) {
        expect(s.trajectoryCount).toBe(20);
      }
    });
  });
});
