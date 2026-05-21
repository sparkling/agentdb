/**
 * Unit Tests for SonaTrajectoryService
 *
 * Tests trajectory recording, frequency-based action prediction, the durable
 * SQLite corpus path (ADR-0181 Item 6), and the in-process RL training methods
 * (policy gradient, TD value estimation, prioritized experience replay,
 * multi-agent reward distribution, transfer & continuous learning).
 *
 * House style: real SonaTrajectoryService instances against a real
 * better-sqlite3 DB loaded with the project schema. Predictions and learning
 * are asserted on observable, deterministic behavior.
 *
 * Runtime note: @ruvector/sona resolves to an object exposing {SonaEngine}
 * with none of the predict/record/findPatterns methods the service probes,
 * so recordTrajectory()/predict()/getPatterns() always fall through to the
 * in-memory + SQLite paths even though initialize() reports engineType='native'.
 * These tests verify that fallthrough behavior is correct and deterministic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  SonaTrajectoryService,
  TrajectoryStep,
  StoredTrajectory,
} from '../../../src/services/SonaTrajectoryService.js';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DB_PATH = './tests/fixtures/test-sona-trajectory.db';
const DB_FILES = [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`];

function cleanup(): void {
  DB_FILES.forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
}

function loadSchema(db: Database.Database): void {
  const schemaPath = path.join(__dirname, '../../../src/schemas/schema.sql');
  db.exec(fs.readFileSync(schemaPath, 'utf-8'));
}

describe('SonaTrajectoryService', () => {
  describe('initialize / engine state', () => {
    it('returns a boolean and keeps engine type consistent with availability', async () => {
      const svc = new SonaTrajectoryService();
      const loaded = await svc.initialize();
      expect(typeof loaded).toBe('boolean');
      if (loaded) {
        expect(svc.getEngineType()).toBe('native');
        expect(svc.isAvailable()).toBe(true);
      } else {
        expect(svc.getEngineType()).toBe('js');
        expect(svc.isAvailable()).toBe(false);
      }
    });

    it('reports a valid engine type string', async () => {
      const svc = new SonaTrajectoryService();
      await svc.initialize();
      expect(['native', 'js']).toContain(svc.getEngineType());
    });

    it('works without initialize() being called (lazy paths default to in-memory)', async () => {
      const svc = new SonaTrajectoryService();
      // No initialize() — isAvailable() defaults to false
      expect(svc.isAvailable()).toBe(false);
      await svc.recordTrajectory('coder', [{ state: { task: 'x' }, action: 'a', reward: 0.5 }]);
      expect(svc.getStats().trajectoryCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // In-memory-only mode (no getDb resolver)
  // -------------------------------------------------------------------------
  describe('in-memory mode (no SQLite handle)', () => {
    let svc: SonaTrajectoryService;

    beforeEach(async () => {
      svc = new SonaTrajectoryService();
      await svc.initialize();
    });

    describe('recordTrajectory', () => {
      it('stores a trajectory and reflects it in stats', async () => {
        await svc.recordTrajectory('coder', [
          { state: { task: 'implement' }, action: 'write_code', reward: 0.8 },
          { state: { task: 'test' }, action: 'run_tests', reward: 0.9 },
        ]);
        const stats = svc.getStats();
        expect(stats.trajectoryCount).toBe(1);
        expect(stats.agentTypes).toContain('coder');
      });

      it('is a no-op for an empty step list', async () => {
        await svc.recordTrajectory('coder', []);
        expect(svc.getStats().trajectoryCount).toBe(0);
        expect(svc.getStats().agentTypes).toEqual([]);
      });

      it('aggregates reward as the mean of step rewards', async () => {
        await svc.recordTrajectory('agent', [
          { state: {}, action: 'a', reward: 0.2 },
          { state: {}, action: 'b', reward: 0.8 },
        ]);
        const patterns = await svc.getPatterns('agent');
        expect(patterns).toHaveLength(1);
        expect(patterns[0].reward).toBeCloseTo(0.5, 5);
      });

      it('accumulates multiple trajectories per agent type', async () => {
        await svc.recordTrajectory('coder', [{ state: {}, action: 'a', reward: 0.5 }]);
        await svc.recordTrajectory('coder', [{ state: {}, action: 'b', reward: 0.6 }]);
        await svc.recordTrajectory('reviewer', [{ state: {}, action: 'c', reward: 0.7 }]);

        const stats = svc.getStats();
        expect(stats.trajectoryCount).toBe(3);
        expect(stats.agentTypes).toEqual(expect.arrayContaining(['coder', 'reviewer']));
        expect(stats.agentTypes).toHaveLength(2);
      });
    });

    describe('getPatterns', () => {
      beforeEach(async () => {
        await svc.recordTrajectory('coder', [{ state: {}, action: 'write', reward: 0.8 }]);
        await svc.recordTrajectory('reviewer', [{ state: {}, action: 'review', reward: 0.9 }]);
      });

      it('returns all patterns when no agent type is given', async () => {
        const patterns = await svc.getPatterns();
        expect(patterns).toHaveLength(2);
      });

      it('filters patterns by agent type', async () => {
        const coderPatterns = await svc.getPatterns('coder');
        expect(coderPatterns).toHaveLength(1);
        expect(coderPatterns[0].steps[0].action).toBe('write');
      });

      it('returns an empty array for an unknown agent type', async () => {
        const patterns = await svc.getPatterns('unknown');
        expect(patterns).toEqual([]);
      });
    });

    describe('predict (frequency-based)', () => {
      it('returns the default prediction with no recorded trajectories', async () => {
        const result = await svc.predict({ task: 'anything' });
        expect(result.action).toBe('default');
        expect(result.confidence).toBe(0.5);
      });

      it('predicts the action with the highest average reward', async () => {
        await svc.recordTrajectory('coder', [
          { state: {}, action: 'low_value', reward: 0.1 },
          { state: {}, action: 'high_value', reward: 0.95 },
        ]);
        const result = await svc.predict({ task: 'implement' });
        expect(result.action).toBe('high_value');
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.confidence).toBeLessThanOrEqual(0.95);
      });

      it('confidence reflects the observation proportion of the chosen action', async () => {
        // 'win' appears 3x (avg reward 0.9), 'lose' appears 1x (reward 0.1).
        // 'win' has highest avg reward; confidence = 3/4 = 0.75.
        await svc.recordTrajectory('a', [
          { state: {}, action: 'win', reward: 0.9 },
          { state: {}, action: 'win', reward: 0.9 },
          { state: {}, action: 'win', reward: 0.9 },
          { state: {}, action: 'lose', reward: 0.1 },
        ]);
        const result = await svc.predict({});
        expect(result.action).toBe('win');
        expect(result.confidence).toBeCloseTo(0.75, 5);
      });

      it('caps confidence at 0.95 even when one action dominates entirely', async () => {
        for (let i = 0; i < 50; i++) {
          await svc.recordTrajectory('a', [{ state: {}, action: 'only', reward: 0.5 }]);
        }
        const result = await svc.predict({});
        expect(result.action).toBe('only');
        expect(result.confidence).toBeLessThanOrEqual(0.95);
        expect(result.confidence).toBe(0.95);
      });
    });

    describe('clear', () => {
      beforeEach(async () => {
        await svc.recordTrajectory('coder', [{ state: {}, action: 'a', reward: 0.5 }]);
        await svc.recordTrajectory('reviewer', [{ state: {}, action: 'b', reward: 0.6 }]);
      });

      it('clears a single agent type', () => {
        svc.clear('coder');
        const stats = svc.getStats();
        expect(stats.agentTypes).toEqual(['reviewer']);
        expect(stats.trajectoryCount).toBe(1);
      });

      it('clears all trajectories when no agent type given', () => {
        svc.clear();
        const stats = svc.getStats();
        expect(stats.trajectoryCount).toBe(0);
        expect(stats.agentTypes).toEqual([]);
      });

      it('clearing an unknown agent type is a safe no-op', () => {
        svc.clear('nonexistent');
        expect(svc.getStats().trajectoryCount).toBe(2);
      });
    });

    describe('getStats', () => {
      it('returns zero counts for a fresh service', () => {
        const stats = svc.getStats();
        expect(stats.trajectoryCount).toBe(0);
        expect(stats.agentTypes).toEqual([]);
        expect(typeof stats.available).toBe('boolean');
      });
    });
  });

  // -------------------------------------------------------------------------
  // Durable SQLite mode (ADR-0181 Item 6)
  // -------------------------------------------------------------------------
  describe('durable SQLite mode (getDb resolver)', () => {
    let db: Database.Database;
    let svc: SonaTrajectoryService;

    beforeEach(async () => {
      cleanup();
      db = new Database(TEST_DB_PATH);
      db.pragma('journal_mode = WAL');
      loadSchema(db);
      svc = new SonaTrajectoryService({ getDb: () => db });
      await svc.initialize();
    });

    afterEach(() => {
      db.close();
      cleanup();
    });

    it('writes a corpus row to sona_trajectories on recordTrajectory', async () => {
      const steps: TrajectoryStep[] = [
        { state: { task: 'implement' }, action: 'write_code', reward: 0.8 },
      ];
      await svc.recordTrajectory('coder', steps);

      const row = db
        .prepare('SELECT agent_type, steps, reward FROM sona_trajectories WHERE agent_type = ?')
        .get('coder') as { agent_type: string; steps: string; reward: number };

      expect(row).toBeDefined();
      expect(row.agent_type).toBe('coder');
      expect(row.reward).toBeCloseTo(0.8, 5);
      expect(JSON.parse(row.steps)).toEqual(steps);
    });

    it('persists the aggregated (mean) reward to the corpus row', async () => {
      await svc.recordTrajectory('coder', [
        { state: {}, action: 'a', reward: 0.4 },
        { state: {}, action: 'b', reward: 0.6 },
      ]);
      const row = db
        .prepare('SELECT reward FROM sona_trajectories WHERE agent_type = ?')
        .get('coder') as { reward: number };
      expect(row.reward).toBeCloseTo(0.5, 5);
    });

    it('does not write a corpus row for an empty step list', async () => {
      await svc.recordTrajectory('coder', []);
      const count = db
        .prepare('SELECT COUNT(*) AS c FROM sona_trajectories')
        .get() as { c: number };
      expect(count.c).toBe(0);
    });

    it('getStats merges in-memory and durable rows (count = max, agents = union)', async () => {
      // Pre-seed a durable row from a "different process" — directly inserted,
      // so it lives only in SQLite, not the in-memory Map.
      db.prepare('INSERT INTO sona_trajectories (agent_type, steps, reward) VALUES (?, ?, ?)')
        .run('prior_process_agent', JSON.stringify([{ state: {}, action: 'x', reward: 0.5 }]), 0.5);

      // Record one through the service (writes both Map + SQLite).
      await svc.recordTrajectory('coder', [{ state: {}, action: 'y', reward: 0.7 }]);

      const stats = svc.getStats();
      // SQLite now has 2 rows; Map has 1. trajectoryCount = max(1, 2) = 2.
      expect(stats.trajectoryCount).toBe(2);
      // Union of Map keys {coder} and DB distinct {prior_process_agent, coder}.
      expect(stats.agentTypes).toEqual(
        expect.arrayContaining(['coder', 'prior_process_agent'])
      );
      expect(stats.agentTypes).toHaveLength(2);
    });

    it('getPatterns merges in-memory and durable rows', async () => {
      // Durable-only row (simulating a prior process)
      db.prepare('INSERT INTO sona_trajectories (agent_type, steps, reward) VALUES (?, ?, ?)')
        .run('coder', JSON.stringify([{ state: {}, action: 'durable', reward: 0.9 }]), 0.9);

      // In-memory + durable row via service
      await svc.recordTrajectory('coder', [{ state: {}, action: 'fresh', reward: 0.6 }]);

      const patterns = await svc.getPatterns('coder');
      // 1 in-memory (fresh) + 2 durable (durable + fresh's own write) = 3
      expect(patterns.length).toBe(3);
      const actions = patterns.flatMap(p => p.steps.map(s => s.action));
      expect(actions).toContain('durable');
      expect(actions).toContain('fresh');
    });

    it('getPatterns without agent type reads all durable rows', async () => {
      db.prepare('INSERT INTO sona_trajectories (agent_type, steps, reward) VALUES (?, ?, ?)')
        .run('agentA', JSON.stringify([{ state: {}, action: 'a', reward: 0.5 }]), 0.5);
      db.prepare('INSERT INTO sona_trajectories (agent_type, steps, reward) VALUES (?, ?, ?)')
        .run('agentB', JSON.stringify([{ state: {}, action: 'b', reward: 0.5 }]), 0.5);

      const patterns = await svc.getPatterns();
      // 2 durable rows, no in-memory entries
      expect(patterns.length).toBe(2);
    });

    it('round-trips multi-step trajectories through SQLite (parses back to TrajectoryStep[])', async () => {
      const steps: TrajectoryStep[] = [
        { state: { phase: 1, nested: { a: 1 } }, action: 'step1', reward: 0.3 },
        { state: { phase: 2 }, action: 'step2', reward: 0.7 },
      ];
      await svc.recordTrajectory('multi', steps);
      svc.clear('multi'); // wipe in-memory so getPatterns reads purely from SQLite

      const patterns = await svc.getPatterns('multi');
      expect(patterns).toHaveLength(1);
      expect(patterns[0].steps).toEqual(steps);
    });

    it('re-throws SQL errors instead of silently swallowing them (no fallback masking)', async () => {
      // Drop the table so the INSERT throws — must surface, per
      // feedback-best-effort-must-rethrow-fatals.
      db.exec('DROP TABLE sona_trajectories');
      await expect(
        svc.recordTrajectory('coder', [{ state: {}, action: 'a', reward: 0.5 }])
      ).rejects.toThrow();
    });

    it('falls back to in-memory-only when the resolver returns null', async () => {
      const nullSvc = new SonaTrajectoryService({ getDb: () => null });
      await nullSvc.initialize();
      await nullSvc.recordTrajectory('coder', [{ state: {}, action: 'a', reward: 0.5 }]);
      // No durable handle -> stats come purely from the in-memory Map
      expect(nullSvc.getStats().trajectoryCount).toBe(1);
    });

    it('degrades to in-memory for a call where the resolver throws (durability lost, write kept)', async () => {
      let shouldThrow = false;
      const flakySvc = new SonaTrajectoryService({
        getDb: () => {
          if (shouldThrow) throw new Error('handle mid-shutdown');
          return db;
        },
      });
      await flakySvc.initialize();

      shouldThrow = true;
      // Resolver throws -> resolveDb() catches -> no SQL write, but in-memory write happens.
      await expect(
        flakySvc.recordTrajectory('coder', [{ state: {}, action: 'a', reward: 0.5 }])
      ).resolves.toBeUndefined();

      // The in-memory write survived even though durability was skipped for this call.
      shouldThrow = false;
      // getStats now resolves the db; SQLite has 0 rows but the Map has 1 -> max = 1.
      expect(flakySvc.getStats().trajectoryCount).toBe(1);
      const dbCount = db.prepare('SELECT COUNT(*) AS c FROM sona_trajectories').get() as { c: number };
      expect(dbCount.c).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // RL Training: Policy Gradient
  // -------------------------------------------------------------------------
  describe('trainPolicy (REINFORCE with baseline)', () => {
    let svc: SonaTrajectoryService;

    beforeEach(async () => {
      svc = new SonaTrajectoryService();
      await svc.initialize();
    });

    it('returns a finite non-negative loss and increments iteration count', async () => {
      const episodes: StoredTrajectory[] = [
        {
          steps: [
            { state: {}, action: 'a', reward: 1.0 },
            { state: {}, action: 'b', reward: 0.5 },
          ],
          reward: 0.75,
        },
      ];
      const loss = await svc.trainPolicy(episodes);
      expect(Number.isFinite(loss)).toBe(true);
      expect(loss).toBeGreaterThanOrEqual(0);
      expect(svc.getRLMetrics().iterationCount).toBe(1);
      expect(svc.getRLMetrics().loss).toBe(loss);
    });

    it('decays epsilon (exploration rate) after training', async () => {
      const before = svc.getRLMetrics().epsilon;
      await svc.trainPolicy([{ steps: [{ state: {}, action: 'a', reward: 1 }], reward: 1 }]);
      const after = svc.getRLMetrics().epsilon;
      expect(after).toBeLessThan(before);
      expect(after).toBeGreaterThanOrEqual(0.01); // floor
    });

    it('never decays epsilon below the 0.01 floor', async () => {
      for (let i = 0; i < 500; i++) {
        await svc.trainPolicy([{ steps: [{ state: {}, action: 'a', reward: 1 }], reward: 1 }]);
      }
      expect(svc.getRLMetrics().epsilon).toBeGreaterThanOrEqual(0.01);
    });

    it('accepts a config override that influences training (gamma)', async () => {
      const loss = await svc.trainPolicy(
        [{ steps: [{ state: {}, action: 'a', reward: 1 }, { state: {}, action: 'b', reward: 1 }], reward: 1 }],
        { gamma: 0.5 }
      );
      expect(Number.isFinite(loss)).toBe(true);
      expect(loss).toBeGreaterThanOrEqual(0);
    });

    it('handles an empty episode list (loss 0, still counts an iteration)', async () => {
      const loss = await svc.trainPolicy([]);
      expect(loss).toBe(0);
      expect(svc.getRLMetrics().iterationCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // RL Training: Value Function (TD learning)
  // -------------------------------------------------------------------------
  describe('estimateValue (TD learning)', () => {
    let svc: SonaTrajectoryService;

    beforeEach(async () => {
      svc = new SonaTrajectoryService();
      await svc.initialize();
    });

    it('moves the value estimate toward the observed reward', async () => {
      // V(s) starts at 0; with reward 1.0 and V(s')=0, TD error = 1.0,
      // new V(s) = 0 + lr * 1.0 = 0.001 (default lr).
      const value = await svc.estimateValue({ s: 1 }, 1.0, { s: 2 });
      expect(value).toBeGreaterThan(0);
      expect(value).toBeCloseTo(0.001, 6);
    });

    it('repeated updates accumulate toward the target', async () => {
      const state = { s: 'fixed' };
      const next = { s: 'next' };
      let v = 0;
      for (let i = 0; i < 10; i++) {
        v = await svc.estimateValue(state, 1.0, next);
      }
      // Monotonically increasing toward the reward target
      expect(v).toBeGreaterThan(0.001);
    });

    it('produces a negative estimate for a negative reward', async () => {
      const value = await svc.estimateValue({ s: 'neg' }, -1.0, { s: 'next' });
      expect(value).toBeLessThan(0);
    });

    it('respects a custom learning rate override', async () => {
      const value = await svc.estimateValue({ s: 'lr' }, 1.0, { s: 'next' }, { learningRate: 0.5 });
      // TD error = 1.0, new V = 0 + 0.5 * 1.0 = 0.5
      expect(value).toBeCloseTo(0.5, 6);
    });
  });

  // -------------------------------------------------------------------------
  // RL Training: Experience Replay
  // -------------------------------------------------------------------------
  describe('experience replay (addExperience / sampleExperience)', () => {
    let svc: SonaTrajectoryService;

    beforeEach(async () => {
      svc = new SonaTrajectoryService();
      await svc.initialize();
    });

    it('returns an empty batch when the buffer is empty', () => {
      expect(svc.sampleExperience()).toEqual([]);
    });

    it('samples experiences after they are added', () => {
      for (let i = 0; i < 10; i++) {
        svc.addExperience({ s: i }, `action_${i}`, 0.5, { s: i + 1 });
      }
      const batch = svc.sampleExperience(5);
      expect(batch).toHaveLength(5);
      batch.forEach(exp => {
        expect(exp).toHaveProperty('state');
        expect(exp).toHaveProperty('action');
        expect(exp).toHaveProperty('reward');
        expect(exp).toHaveProperty('nextState');
      });
    });

    it('clamps the batch to the buffer size when fewer experiences exist', () => {
      svc.addExperience({ s: 0 }, 'a', 0.5, { s: 1 });
      svc.addExperience({ s: 1 }, 'b', 0.5, { s: 2 });
      const batch = svc.sampleExperience(10);
      expect(batch.length).toBe(2);
    });

    it('honors the configured buffer size (oldest entries evicted)', () => {
      svc.configureRL({ replay: { bufferSize: 3 } });
      for (let i = 0; i < 6; i++) {
        svc.addExperience({ s: i }, `a${i}`, 0.5, { s: i + 1 });
      }
      // Buffer capped at 3 — request more than that and confirm the cap holds.
      const batch = svc.sampleExperience(100);
      expect(batch.length).toBe(3);
    });

    it('only samples high-priority experiences when priority is skewed', () => {
      // One experience with overwhelming priority; the rest near-zero.
      svc.addExperience({ s: 'high' }, 'high_priority', 1.0, { s: 'h2' }, 1000);
      for (let i = 0; i < 5; i++) {
        svc.addExperience({ s: i }, 'low_priority', 0.1, { s: i + 1 }, 0.0001);
      }
      const batch = svc.sampleExperience(10);
      // With ~all probability mass on the high-priority entry, every draw
      // should select it.
      expect(batch.every(e => e.action === 'high_priority')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Multi-agent learning
  // -------------------------------------------------------------------------
  describe('multiAgentLearn', () => {
    let svc: SonaTrajectoryService;

    beforeEach(async () => {
      svc = new SonaTrajectoryService();
      await svc.initialize();
    });

    it('distributes a joint reward across all participating agents', async () => {
      const states = new Map<string, any>([
        ['agent1', { task: 'a' }],
        ['agent2', { task: 'b' }],
      ]);
      const actions = new Map<string, string>([
        ['agent1', 'act1'],
        ['agent2', 'act2'],
      ]);

      const rewards = await svc.multiAgentLearn(states, actions, 2.0);

      expect(rewards.size).toBe(2);
      expect(rewards.has('agent1')).toBe(true);
      expect(rewards.has('agent2')).toBe(true);
      // Each reward is finite and positive (baseReward 1.0 * [0.5, 1.0] band)
      for (const r of rewards.values()) {
        expect(Number.isFinite(r)).toBe(true);
        expect(r).toBeGreaterThan(0);
      }
    });

    it('records a trajectory for each agent as a side effect', async () => {
      const states = new Map<string, any>([
        ['agent1', { task: 'a' }],
        ['agent2', { task: 'b' }],
      ]);
      const actions = new Map<string, string>([
        ['agent1', 'act1'],
        ['agent2', 'act2'],
      ]);

      await svc.multiAgentLearn(states, actions, 2.0);

      const stats = svc.getStats();
      expect(stats.trajectoryCount).toBe(2);
      expect(stats.agentTypes).toEqual(expect.arrayContaining(['agent1', 'agent2']));
    });

    it('defaults missing actions to "default"', async () => {
      const states = new Map<string, any>([['agent1', { task: 'a' }]]);
      const actions = new Map<string, string>(); // no entry for agent1

      const rewards = await svc.multiAgentLearn(states, actions, 1.0);
      expect(rewards.has('agent1')).toBe(true);

      const patterns = await svc.getPatterns('agent1');
      expect(patterns[0].steps[0].action).toBe('default');
    });
  });

  // -------------------------------------------------------------------------
  // Transfer learning
  // -------------------------------------------------------------------------
  describe('transferLearning', () => {
    let svc: SonaTrajectoryService;

    beforeEach(async () => {
      svc = new SonaTrajectoryService();
      await svc.initialize();
    });

    it('returns false when the source agent has no patterns', async () => {
      const ok = await svc.transferLearning('unknown_source', 'target');
      expect(ok).toBe(false);
    });

    it('returns true when the source agent has recorded patterns', async () => {
      await svc.recordTrajectory('source', [{ state: {}, action: 'a', reward: 0.8 }]);
      const ok = await svc.transferLearning('source', 'target');
      expect(ok).toBe(true);
    });

    it('blends value estimates from source to target agent states', async () => {
      // Seed a value estimate keyed on a state tagged with agentType 'source'.
      await svc.recordTrajectory('source', [{ state: {}, action: 'a', reward: 0.8 }]);
      await svc.estimateValue({ agentType: 'source', step: 1 }, 1.0, { agentType: 'source', step: 2 });

      const ok = await svc.transferLearning('source', 'target', 0.7);
      expect(ok).toBe(true);
      // The transfer should not throw and should report success; the target
      // value key is created internally. We assert behavior via no-throw +
      // truthy return (internal weights are private).
    });
  });

  // -------------------------------------------------------------------------
  // Continuous learning
  // -------------------------------------------------------------------------
  describe('continuousLearn', () => {
    let svc: SonaTrajectoryService;

    beforeEach(async () => {
      svc = new SonaTrajectoryService();
      await svc.initialize();
    });

    it('returns a finite value estimate and updates episode metrics', async () => {
      const value = await svc.continuousLearn({ s: 1 }, 'a', 0.5, { s: 2 });
      expect(Number.isFinite(value)).toBe(true);
      const metrics = svc.getRLMetrics();
      expect(metrics.episodeReward).toBeCloseTo(0.5, 6);
    });

    it('accumulates episode reward across multiple updates', async () => {
      await svc.continuousLearn({ s: 1 }, 'a', 0.5, { s: 2 });
      await svc.continuousLearn({ s: 2 }, 'b', 0.3, { s: 3 });
      expect(svc.getRLMetrics().episodeReward).toBeCloseTo(0.8, 6);
    });

    it('triggers policy training once the batch threshold is reached', async () => {
      svc.configureRL({ replay: { batchSize: 4 } });
      // Each continuousLearn adds one experience; the 4th should trigger trainPolicy.
      for (let i = 0; i < 4; i++) {
        await svc.continuousLearn({ s: i }, `a${i}`, 0.5, { s: i + 1 });
      }
      // trainPolicy increments iterationCount; with batchSize=4 it fires on the 4th call.
      expect(svc.getRLMetrics().iterationCount).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // RL state management
  // -------------------------------------------------------------------------
  describe('RL state management (getRLMetrics / resetRL / configureRL)', () => {
    let svc: SonaTrajectoryService;

    beforeEach(async () => {
      svc = new SonaTrajectoryService();
      await svc.initialize();
    });

    it('returns a defensive copy from getRLMetrics', () => {
      const m1 = svc.getRLMetrics();
      m1.loss = 999;
      const m2 = svc.getRLMetrics();
      expect(m2.loss).not.toBe(999);
    });

    it('exposes the expected metric fields with sane initial values', () => {
      const m = svc.getRLMetrics();
      expect(m).toMatchObject({
        episodeReward: 0,
        avgReward: 0,
        loss: 0,
        iterationCount: 0,
      });
      expect(m.epsilon).toBeGreaterThan(0);
    });

    it('resetRL clears training metrics back to zero', async () => {
      await svc.trainPolicy([{ steps: [{ state: {}, action: 'a', reward: 1 }], reward: 1 }]);
      await svc.continuousLearn({ s: 1 }, 'a', 0.5, { s: 2 });
      expect(svc.getRLMetrics().iterationCount).toBeGreaterThan(0);

      svc.resetRL();
      const m = svc.getRLMetrics();
      expect(m.iterationCount).toBe(0);
      expect(m.episodeReward).toBe(0);
      expect(m.avgReward).toBe(0);
      expect(m.loss).toBe(0);
    });

    it('configureRL merges partial policy/value/replay configs without throwing', () => {
      expect(() =>
        svc.configureRL({
          policy: { learningRate: 0.01 },
          value: { gamma: 0.8 },
          replay: { batchSize: 16 },
        })
      ).not.toThrow();
    });

    it('configureRL changes only the provided sub-configs (replay batchSize applied)', () => {
      svc.configureRL({ replay: { batchSize: 2 } });
      svc.addExperience({ s: 0 }, 'a', 0.5, { s: 1 });
      svc.addExperience({ s: 1 }, 'b', 0.5, { s: 2 });
      svc.addExperience({ s: 2 }, 'c', 0.5, { s: 3 });
      // Default batch size is now 2
      const batch = svc.sampleExperience();
      expect(batch).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('edge cases', () => {
    let svc: SonaTrajectoryService;

    beforeEach(async () => {
      svc = new SonaTrajectoryService();
      await svc.initialize();
    });

    it('handles Unicode agent types and action names', async () => {
      await svc.recordTrajectory('代理-🤖', [
        { state: { 任务: 'x' }, action: '执行-✅', reward: 0.9 },
      ]);
      const stats = svc.getStats();
      expect(stats.agentTypes).toContain('代理-🤖');
      const result = await svc.predict({});
      expect(result.action).toBe('执行-✅');
    });

    it('handles reward boundary values (0 and 1)', async () => {
      await svc.recordTrajectory('a', [
        { state: {}, action: 'zero', reward: 0 },
        { state: {}, action: 'one', reward: 1 },
      ]);
      const patterns = await svc.getPatterns('a');
      expect(patterns[0].reward).toBeCloseTo(0.5, 6);
      const result = await svc.predict({});
      expect(result.action).toBe('one'); // highest avg reward
    });

    it('handles negative rewards in frequency prediction', async () => {
      await svc.recordTrajectory('a', [
        { state: {}, action: 'bad', reward: -1 },
        { state: {}, action: 'good', reward: 0.5 },
      ]);
      const result = await svc.predict({});
      expect(result.action).toBe('good');
    });

    it('handles a complex nested state object', async () => {
      await svc.recordTrajectory('a', [
        { state: { deep: { nested: { value: [1, 2, 3] } } }, action: 'complex', reward: 0.7 },
      ]);
      const patterns = await svc.getPatterns('a');
      expect(patterns[0].steps[0].state.deep.nested.value).toEqual([1, 2, 3]);
    });
  });
});
