/**
 * SonaLearningBackend Tests
 *
 * Tests Phase 1 of ADR-005: Self-Learning Pipeline Integration
 * - Creation and availability detection
 * - Configuration validation and bounds checking
 * - Lifecycle management (create, destroy)
 * - Graceful failure when @ruvector/sona is not available
 */

import { describe, it, expect } from 'vitest';
import {
  SonaLearningBackend,
  type SonaConfig,
} from '../../src/backends/rvf/SonaLearningBackend.js';

describe('SonaLearningBackend', () => {
  describe('availability', () => {
    it('should detect whether @ruvector/sona is installed', async () => {
      const available = await SonaLearningBackend.isAvailable();
      // Result depends on environment - just ensure it returns a boolean
      expect(typeof available).toBe('boolean');
    });
  });

  describe('creation with valid config', () => {
    it('should reject hiddenDim < 1', async () => {
      await expect(
        SonaLearningBackend.create({ hiddenDim: 0 }),
      ).rejects.toThrow('hiddenDim must be between 1 and 4096');
    });

    it('should reject hiddenDim > 4096', async () => {
      await expect(
        SonaLearningBackend.create({ hiddenDim: 5000 }),
      ).rejects.toThrow('hiddenDim must be between 1 and 4096');
    });

    it('should reject non-finite hiddenDim', async () => {
      await expect(
        SonaLearningBackend.create({ hiddenDim: NaN }),
      ).rejects.toThrow('hiddenDim must be between 1 and 4096');

      await expect(
        SonaLearningBackend.create({ hiddenDim: Infinity }),
      ).rejects.toThrow('hiddenDim must be between 1 and 4096');
    });
  });

  describe('creation without @ruvector/sona', () => {
    it('should throw a helpful error message when sona is not installed', async () => {
      // If @ruvector/sona is not installed, create() should throw a meaningful error
      const available = await SonaLearningBackend.isAvailable();
      if (!available) {
        await expect(
          SonaLearningBackend.create({ hiddenDim: 128 }),
        ).rejects.toThrow('SONA engine initialization failed');
      }
    });
  });

  describe('config bounds clamping', () => {
    // These tests verify the bounds in the create() method
    // even though they can't be tested without @ruvector/sona installed,
    // we verify that the validation path for hiddenDim works

    it('should validate hiddenDim edge cases', async () => {
      // Exactly 1 - valid
      try {
        await SonaLearningBackend.create({ hiddenDim: 1 });
      } catch (e) {
        // May fail due to @ruvector/sona not installed, but shouldn't fail on validation
        expect((e as Error).message).not.toContain('hiddenDim');
      }

      // Exactly 4096 - valid
      try {
        await SonaLearningBackend.create({ hiddenDim: 4096 });
      } catch (e) {
        expect((e as Error).message).not.toContain('hiddenDim');
      }
    });
  });

  describe('native engine integration', () => {
    let backend: SonaLearningBackend | null = null;

    it('should create and destroy if sona is available', async () => {
      const available = await SonaLearningBackend.isAvailable();
      if (!available) {
        // Skip test if sona is not installed
        return;
      }

      backend = await SonaLearningBackend.create({
        hiddenDim: 128,
        microLoraRank: 1,
        ewcLambda: 100,
        trajectoryCapacity: 100,
      });

      expect(backend).toBeDefined();
      expect(backend.dimension).toBe(128);
      expect(backend.isDestroyed).toBe(false);

      // Test enhance
      const query = new Float32Array(128).fill(0.1);
      const enhanced = backend.enhance(query);
      expect(enhanced.length).toBe(128);

      // Test stats
      const stats = backend.getStats();
      expect(stats.enabled).toBe(true);
      expect(stats.totalTrajectories).toBe(0);

      // Test trajectory lifecycle
      const tid = backend.beginTrajectory(query);
      expect(typeof tid).toBe('number');

      const activations = new Float32Array(128).fill(0.5);
      backend.addStep(tid, activations, 0.8);
      backend.endTrajectory(tid, 0.9);

      // Test tick (may or may not return a string depending on whether learning is due)
      backend.tick();

      // Test find patterns
      const patterns = backend.findPatterns(query, 3);
      expect(Array.isArray(patterns)).toBe(true);

      // Destroy
      backend.destroy();
      expect(backend.isDestroyed).toBe(true);
      expect(() => backend!.enhance(query)).toThrow('destroyed');
      backend = null;
    });

    it('should reject unknown trajectory IDs', async () => {
      const available = await SonaLearningBackend.isAvailable();
      if (!available) return;

      backend = await SonaLearningBackend.create({ hiddenDim: 64 });
      const activations = new Float32Array(64).fill(0.5);

      expect(() => backend!.addStep(99999, activations, 0.5)).toThrow(
        'Unknown trajectory ID',
      );

      backend.destroy();
      backend = null;
    });
  });

  describe('type exports', () => {
    it('should export SonaConfig interface', () => {
      const config: SonaConfig = {
        hiddenDim: 128,
        embeddingDim: 128,
        microLoraRank: 1,
        baseLoraRank: 8,
        ewcLambda: 1000,
        patternClusters: 50,
        trajectoryCapacity: 10000,
        backgroundIntervalMs: 3600000,
        qualityThreshold: 0.5,
      };
      expect(config.hiddenDim).toBe(128);
    });
  });
});
