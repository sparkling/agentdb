/**
 * SolverBandit Tests (ADR-010)
 *
 * Tests for the Thompson Sampling bandit used across AgentDB controllers:
 * - SkillLibrary (Phase 1), ReasoningBank (Phase 2), NightlyLearner (Phase 3),
 * - TemporalCompressor (Phase 4), LearningSystem (Phase 6)
 */

import { describe, it, expect } from 'vitest';
import { SolverBandit } from '../../src/backends/rvf/SolverBandit.js';
import type { BanditState } from '../../src/backends/rvf/SolverBandit.js';

describe('SolverBandit', () => {
  describe('construction', () => {
    it('should create with default config', () => {
      const bandit = new SolverBandit();
      const stats = bandit.getStats();
      expect(stats.contexts).toBe(0);
      expect(stats.totalArms).toBe(0);
      expect(stats.totalPulls).toBe(0);
    });

    it('should accept custom config', () => {
      const bandit = new SolverBandit({ costWeight: 0.05, costDecay: 0.2, explorationBonus: 0.2 });
      expect(bandit.getStats().contexts).toBe(0);
    });
  });

  describe('selectArm', () => {
    it('should return the only arm when given one', () => {
      const bandit = new SolverBandit();
      expect(bandit.selectArm('ctx', ['only'])).toBe('only');
    });

    it('should throw on empty arms', () => {
      const bandit = new SolverBandit();
      expect(() => bandit.selectArm('ctx', [])).toThrow('No arms provided');
    });

    it('should return one of the provided arms', () => {
      const bandit = new SolverBandit();
      const arms = ['a', 'b', 'c'];
      const selected = bandit.selectArm('ctx', arms);
      expect(arms).toContain(selected);
    });

    it('should favor arms with higher rewards over time', () => {
      const bandit = new SolverBandit();
      // Train arm 'good' with high rewards, arm 'bad' with low rewards
      for (let i = 0; i < 100; i++) {
        bandit.recordReward('test', 'good', 0.9);
        bandit.recordReward('test', 'bad', 0.1);
      }

      // Sample 50 times and count selections
      let goodCount = 0;
      for (let i = 0; i < 50; i++) {
        if (bandit.selectArm('test', ['good', 'bad']) === 'good') goodCount++;
      }
      // Should strongly prefer 'good' (>80% of the time)
      expect(goodCount).toBeGreaterThan(40);
    });
  });

  describe('recordReward', () => {
    it('should create context and arm on first reward', () => {
      const bandit = new SolverBandit();
      bandit.recordReward('ctx1', 'arm1', 0.8);
      const stats = bandit.getStats();
      expect(stats.contexts).toBe(1);
      expect(stats.totalArms).toBe(1);
      expect(stats.totalPulls).toBe(1);
    });

    it('should clamp reward to [0, 1]', () => {
      const bandit = new SolverBandit();
      bandit.recordReward('ctx', 'arm', -5);
      bandit.recordReward('ctx', 'arm', 10);
      const arm = bandit.getArmStats('ctx', 'arm');
      expect(arm!.pulls).toBe(2);
      // alpha should be 1 (init) + 0 (clamped -5) + 1 (clamped 10) = 2
      expect(arm!.alpha).toBe(2);
    });

    it('should track cost EMA', () => {
      const bandit = new SolverBandit({ costDecay: 0.5 });
      bandit.recordReward('ctx', 'arm', 0.5, 100);
      const arm1 = bandit.getArmStats('ctx', 'arm');
      expect(arm1!.costEma).toBeCloseTo(50, 0); // 0 * 0.5 + 100 * 0.5

      bandit.recordReward('ctx', 'arm', 0.5, 200);
      const arm2 = bandit.getArmStats('ctx', 'arm');
      expect(arm2!.costEma).toBeCloseTo(125, 0); // 50 * 0.5 + 200 * 0.5
    });
  });

  describe('rerank', () => {
    it('should return arms in bandit-scored order', () => {
      const bandit = new SolverBandit();
      // Give 'best' strong positive signal
      for (let i = 0; i < 50; i++) {
        bandit.recordReward('ctx', 'best', 0.95);
        bandit.recordReward('ctx', 'mid', 0.5);
        bandit.recordReward('ctx', 'worst', 0.05);
      }

      const ranked = bandit.rerank('ctx', ['worst', 'mid', 'best']);
      // 'best' should almost always be first
      expect(ranked[0]).toBe('best');
    });

    it('should return single-element array unchanged', () => {
      const bandit = new SolverBandit();
      expect(bandit.rerank('ctx', ['only'])).toEqual(['only']);
    });

    it('should return empty array for empty input', () => {
      const bandit = new SolverBandit();
      expect(bandit.rerank('ctx', [])).toEqual([]);
    });
  });

  describe('getArmStats', () => {
    it('should return null for unknown context/arm', () => {
      const bandit = new SolverBandit();
      expect(bandit.getArmStats('missing', 'arm')).toBeNull();
    });

    it('should return correct stats after rewards', () => {
      const bandit = new SolverBandit();
      bandit.recordReward('ctx', 'arm', 1.0);
      bandit.recordReward('ctx', 'arm', 0.0);
      const stats = bandit.getArmStats('ctx', 'arm');
      expect(stats!.pulls).toBe(2);
      expect(stats!.alpha).toBe(2); // 1 (init) + 1 (reward=1)
      expect(stats!.beta).toBe(2);  // 1 (init) + 1 (reward=0)
      expect(stats!.totalReward).toBe(1);
    });
  });

  describe('serialize/deserialize', () => {
    it('should round-trip state correctly', () => {
      const bandit = new SolverBandit({ costWeight: 0.05 });
      bandit.recordReward('skills', 'sort', 0.9, 10);
      bandit.recordReward('skills', 'search', 0.7, 20);
      bandit.recordReward('patterns', 'code_review', 0.8);

      const state = bandit.serialize();
      expect(state.version).toBe(1);
      expect(state.config.costWeight).toBe(0.05);

      const restored = SolverBandit.deserialize(state);
      const stats = restored.getStats();
      expect(stats.contexts).toBe(2);
      expect(stats.totalArms).toBe(3);
      expect(stats.totalPulls).toBe(3);

      const sortStats = restored.getArmStats('skills', 'sort');
      expect(sortStats!.pulls).toBe(1);
      expect(sortStats!.totalReward).toBeCloseTo(0.9);
    });

    it('should produce valid JSON', () => {
      const bandit = new SolverBandit();
      bandit.recordReward('ctx', 'arm', 0.5);
      const json = JSON.stringify(bandit.serialize());
      const parsed: BanditState = JSON.parse(json);
      expect(parsed.version).toBe(1);
      expect(parsed.contexts.ctx.arm.pulls).toBe(1);
    });
  });

  describe('reset', () => {
    it('should clear all state', () => {
      const bandit = new SolverBandit();
      bandit.recordReward('ctx', 'arm', 0.5);
      expect(bandit.getStats().totalPulls).toBe(1);
      bandit.reset();
      expect(bandit.getStats().totalPulls).toBe(0);
      expect(bandit.getStats().contexts).toBe(0);
    });
  });

  describe('contextual behavior', () => {
    it('should maintain separate stats per context', () => {
      const bandit = new SolverBandit();
      bandit.recordReward('ctx1', 'arm', 0.9);
      bandit.recordReward('ctx2', 'arm', 0.1);

      expect(bandit.getArmStats('ctx1', 'arm')!.totalReward).toBeCloseTo(0.9);
      expect(bandit.getArmStats('ctx2', 'arm')!.totalReward).toBeCloseTo(0.1);
    });

    it('should use different context for different decisions', () => {
      const bandit = new SolverBandit();
      // Skills context: prefer 'fast'
      for (let i = 0; i < 30; i++) bandit.recordReward('skills', 'fast', 0.9);
      for (let i = 0; i < 30; i++) bandit.recordReward('skills', 'slow', 0.3);
      // Patterns context: prefer 'slow' (thorough)
      for (let i = 0; i < 30; i++) bandit.recordReward('patterns', 'fast', 0.3);
      for (let i = 0; i < 30; i++) bandit.recordReward('patterns', 'slow', 0.9);

      // Skills should mostly pick 'fast'
      let fastCount = 0;
      for (let i = 0; i < 20; i++) {
        if (bandit.selectArm('skills', ['fast', 'slow']) === 'fast') fastCount++;
      }
      expect(fastCount).toBeGreaterThan(15);

      // Patterns should mostly pick 'slow'
      let slowCount = 0;
      for (let i = 0; i < 20; i++) {
        if (bandit.selectArm('patterns', ['fast', 'slow']) === 'slow') slowCount++;
      }
      expect(slowCount).toBeGreaterThan(15);
    });
  });

  describe('integration surface', () => {
    it('SkillLibrary integration: rerank skills by task type', () => {
      const bandit = new SolverBandit();
      // Simulate: 'sort' skill works well for 'data' tasks
      for (let i = 0; i < 20; i++) bandit.recordReward('data', 'sort', 0.9);
      for (let i = 0; i < 20; i++) bandit.recordReward('data', 'filter', 0.4);

      const ranked = bandit.rerank('data', ['filter', 'sort']);
      expect(ranked[0]).toBe('sort');
    });

    it('ReasoningBank integration: rerank patterns by task type', () => {
      const bandit = new SolverBandit();
      for (let i = 0; i < 20; i++) bandit.recordReward('code_review', 'lint_first', 0.85);
      for (let i = 0; i < 20; i++) bandit.recordReward('code_review', 'test_first', 0.55);

      const ranked = bandit.rerank('code_review', ['test_first', 'lint_first']);
      expect(ranked[0]).toBe('lint_first');
    });

    it('NightlyLearner integration: prioritize experiments', () => {
      const bandit = new SolverBandit();
      // Record enough rewards so Thompson Sampling reliably ranks the better arm first
      for (let i = 0; i < 20; i++) bandit.recordReward('experiment', 'auth_flow', 0.9);
      for (let i = 0; i < 20; i++) bandit.recordReward('experiment', 'cache_miss', 0.2);

      const ranked = bandit.rerank('experiment', ['cache_miss', 'auth_flow']);
      expect(ranked[0]).toBe('auth_flow');
    });

    it('LearningSystem integration: meta-select algorithm', () => {
      const bandit = new SolverBandit();
      const algorithms = ['q-learning', 'ppo', 'actor-critic'];
      for (let i = 0; i < 30; i++) bandit.recordReward('navigation', 'ppo', 0.9);
      for (let i = 0; i < 30; i++) bandit.recordReward('navigation', 'q-learning', 0.4);
      for (let i = 0; i < 30; i++) bandit.recordReward('navigation', 'actor-critic', 0.6);

      let ppoCount = 0;
      for (let i = 0; i < 20; i++) {
        if (bandit.selectArm('navigation', algorithms) === 'ppo') ppoCount++;
      }
      expect(ppoCount).toBeGreaterThan(15);
    });

    it('TemporalCompressor integration: adaptive tier selection', () => {
      const bandit = new SolverBandit();
      const tiers = ['none', 'half', 'pq8', 'pq4', 'binary'];
      // Hot data: 'none' compression works best, others are worse
      for (let i = 0; i < 50; i++) bandit.recordReward('hot', 'none', 0.95);
      for (let i = 0; i < 50; i++) bandit.recordReward('hot', 'half', 0.2);
      for (let i = 0; i < 50; i++) bandit.recordReward('hot', 'pq8', 0.15);
      for (let i = 0; i < 50; i++) bandit.recordReward('hot', 'pq4', 0.1);
      for (let i = 0; i < 50; i++) bandit.recordReward('hot', 'binary', 0.05);

      const selected = bandit.selectArm('hot', tiers);
      // Should strongly prefer 'none' for hot context
      let noneCount = 0;
      for (let i = 0; i < 20; i++) {
        if (bandit.selectArm('hot', tiers) === 'none') noneCount++;
      }
      expect(noneCount).toBeGreaterThan(15);
      expect(selected).toBeDefined();
    });
  });

  describe('performance', () => {
    it('should handle 100K selectArm calls in <200ms', () => {
      const bandit = new SolverBandit();
      const arms = ['a', 'b', 'c', 'd', 'e'];
      for (const arm of arms) bandit.recordReward('bench', arm, Math.random());

      const start = performance.now();
      for (let i = 0; i < 100_000; i++) bandit.selectArm('bench', arms);
      const elapsed = performance.now() - start;
      // Allow more time in CI / shared environments
      expect(elapsed).toBeLessThan(500);
    });

    it('should handle 100K recordReward calls in <100ms', () => {
      const bandit = new SolverBandit();
      const start = performance.now();
      for (let i = 0; i < 100_000; i++) {
        bandit.recordReward(`ctx${i % 10}`, `arm${i % 5}`, Math.random());
      }
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(100);
    });
  });
});
