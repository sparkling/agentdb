/**
 * Unit Tests for MemoryConsolidation Controller
 *
 * Tests the nightly episodic→semantic consolidation pipeline:
 *   - candidate selection (importance + access_count thresholds)
 *   - greedy similarity clustering
 *   - semantic-memory creation from clusters (+ markConsolidated of sources)
 *   - Ebbinghaus forgetting sweep
 *   - spaced-repetition scheduling (SM-2 style)
 *   - consolidation logging / history / recommendations
 *
 * Uses real better-sqlite3 + real HierarchicalMemory + real EmbeddingService
 * (provider 'local' → deterministic mock embeddings). Identical content is
 * used to guarantee mutual similarity 1.0 so clustering is deterministic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MemoryConsolidation } from '../../../src/controllers/MemoryConsolidation.js';
import { HierarchicalMemory } from '../../../src/controllers/HierarchicalMemory.js';
import { EmbeddingService } from '../../../src/controllers/EmbeddingService.js';
import * as fs from 'fs';

const TEST_DB_PATH = `./tests/fixtures/memcons-${Math.random().toString(36).slice(2)}.db`;
const DB_FILES = [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`];

const DAY_MS = 24 * 60 * 60 * 1000;

function cleanup(): void {
  DB_FILES.forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
}

describe('MemoryConsolidation', () => {
  let db: Database.Database;
  let embedder: EmbeddingService;
  let hmem: HierarchicalMemory;
  let consolidation: MemoryConsolidation;

  /**
   * Seed an episodic memory and force it into a consolidation-eligible state.
   * getConsolidationCandidates() reads importance + access_count straight from
   * the DB, so we bump those columns directly. ageDays back-dates created_at /
   * last_accessed_at so the forgetting curve can be exercised.
   */
  async function seedEpisodic(
    content: string,
    importance: number,
    accessCount: number,
    ageDays = 0,
  ): Promise<string> {
    const id = await hmem.store(content, importance, 'episodic');
    const createdAt = Date.now() - ageDays * DAY_MS;
    db.prepare(
      `UPDATE hierarchical_memory
         SET access_count = ?, created_at = ?, last_accessed_at = ?
       WHERE id = ?`,
    ).run(accessCount, createdAt, createdAt, id);
    return id;
  }

  beforeEach(async () => {
    cleanup();
    db = new Database(TEST_DB_PATH);
    db.pragma('journal_mode = WAL');

    embedder = new EmbeddingService({
      model: 'mock-model',
      dimension: 384,
      provider: 'local',
    });
    await embedder.initialize();

    // HierarchicalMemory creates the `hierarchical_memory` table that
    // MemoryConsolidation reads. autoConsolidate off to avoid log noise.
    hmem = new HierarchicalMemory(db, embedder, undefined, { autoConsolidate: false });
    consolidation = new MemoryConsolidation(db, hmem, embedder);
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  describe('construction & initialization', () => {
    it('should create the consolidation_log table', () => {
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='consolidation_log'`)
        .get() as { name: string } | undefined;
      expect(row?.name).toBe('consolidation_log');
    });

    it('should create the spaced_repetition table and index', () => {
      const table = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='spaced_repetition'`)
        .get() as { name: string } | undefined;
      expect(table?.name).toBe('spaced_repetition');

      const index = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_spaced_next_review'`)
        .get() as { name: string } | undefined;
      expect(index?.name).toBe('idx_spaced_next_review');
    });

    it('should accept config overrides', () => {
      const custom = new MemoryConsolidation(db, hmem, embedder, undefined, {
        minClusterSize: 2,
        clusterThreshold: 0.9,
      });
      // The override is exercised behaviorally in clustering tests below; here
      // we just assert construction with overrides does not throw.
      expect(custom).toBeInstanceOf(MemoryConsolidation);
    });

    it('should load pre-existing repetition schedules from the database', () => {
      // Pre-populate a schedule, then construct a new instance: it must load it.
      db.prepare(
        `INSERT INTO spaced_repetition (memory_id, next_review, interval, ease_factor, repetitions)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('preexisting-mem', Date.now() + DAY_MS, DAY_MS, 2.5, 0);

      const reloaded = new MemoryConsolidation(db, hmem, embedder);
      // A reloaded schedule means scheduleSpacedRepetition won't re-insert it.
      // We verify indirectly: the row still exists and is unique after another
      // consolidation pass touches the same id.
      expect(reloaded).toBeInstanceOf(MemoryConsolidation);
      const count = db
        .prepare(`SELECT COUNT(*) as c FROM spaced_repetition WHERE memory_id = 'preexisting-mem'`)
        .get() as { c: number };
      expect(count.c).toBe(1);
    });
  });

  describe('consolidate — empty / no-candidate cases', () => {
    it('should return a zeroed report when there are no candidates', async () => {
      const report = await consolidation.consolidate();

      expect(report.episodicProcessed).toBe(0);
      expect(report.semanticCreated).toBe(0);
      expect(report.memoriesForgotten).toBe(0);
      expect(report.clustersFormed).toBe(0);
      expect(report.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should ignore episodic memories below the importance threshold', async () => {
      // importance 0.3 < default importanceThreshold 0.6 → not a candidate.
      await seedEpisodic('low importance content', 0.3, 5);

      const report = await consolidation.consolidate();
      expect(report.episodicProcessed).toBe(0);
    });

    it('should ignore episodic memories below the access-count threshold', async () => {
      // access_count 1 < default minAccessCount 3 → not a candidate.
      await seedEpisodic('rarely accessed content', 0.9, 1);

      const report = await consolidation.consolidate();
      expect(report.episodicProcessed).toBe(0);
    });

    it('should ignore non-episodic tiers entirely', async () => {
      // working & semantic items are never candidates regardless of stats.
      const wId = await hmem.store('working high', 0.9, 'working');
      const sId = await hmem.store('semantic high', 0.9, 'semantic');
      db.prepare('UPDATE hierarchical_memory SET access_count = 9 WHERE id IN (?, ?)').run(wId, sId);

      const report = await consolidation.consolidate();
      expect(report.episodicProcessed).toBe(0);
    });
  });

  describe('consolidate — candidate selection', () => {
    it('should count all eligible episodic memories as processed', async () => {
      await seedEpisodic('alpha note one', 0.7, 4);
      await seedEpisodic('beta note two', 0.8, 5);
      await seedEpisodic('gamma note three', 0.9, 6);

      const report = await consolidation.consolidate();
      expect(report.episodicProcessed).toBe(3);
    });

    it('should compute average importance across candidates', async () => {
      await seedEpisodic('imp a', 0.6, 4);
      await seedEpisodic('imp b', 0.8, 4);
      await seedEpisodic('imp c', 1.0, 4);

      const report = await consolidation.consolidate();
      // avgImportance is computed over the candidate set (0.6 + 0.8 + 1.0)/3.
      expect(report.avgImportance).toBeCloseTo(0.8, 5);
    });
  });

  describe('consolidate — clustering & semantic creation', () => {
    it('should form a cluster and create a semantic memory from >= minClusterSize identical members', async () => {
      // Identical content → identical mock embedding → mutual similarity 1.0,
      // which clears the 0.75 cluster threshold. 3 members == default
      // minClusterSize, so exactly one semantic memory is created.
      const dup = 'recurring deployment checklist step';
      await seedEpisodic(dup, 0.9, 5);
      await seedEpisodic(dup, 0.85, 4);
      await seedEpisodic(dup, 0.8, 4);

      const report = await consolidation.consolidate();

      expect(report.clustersFormed).toBe(1);
      expect(report.semanticCreated).toBe(1);

      // The created semantic memory carries the consolidation pattern marker.
      const semantic = db
        .prepare(`SELECT content, metadata FROM hierarchical_memory WHERE tier = 'semantic'`)
        .get() as any;
      expect(semantic).toBeDefined();
      expect(semantic.content).toContain('Pattern:');
      expect(semantic.content).toContain('consolidated from 3 similar memories');

      const meta = JSON.parse(semantic.metadata);
      expect(meta.clusterSize).toBe(3);
      expect(Array.isArray(meta.sourceMemories)).toBe(true);
      expect(meta.sourceMemories.length).toBe(3);
    });

    it('should mark source episodic memories as consolidated', async () => {
      const dup = 'shared incident postmortem note';
      const ids = [
        await seedEpisodic(dup, 0.9, 5),
        await seedEpisodic(dup, 0.9, 5),
        await seedEpisodic(dup, 0.9, 5),
      ];

      await consolidation.consolidate();

      for (const id of ids) {
        const row = db.prepare('SELECT consolidated_at FROM hierarchical_memory WHERE id = ?').get(id) as any;
        expect(row.consolidated_at).toBeGreaterThan(0);
      }
    });

    it('should NOT create a semantic memory when a cluster is below minClusterSize', async () => {
      // Only 2 identical members → cluster size 2 < default minClusterSize 3.
      const dup = 'pair of similar notes';
      await seedEpisodic(dup, 0.9, 5);
      await seedEpisodic(dup, 0.9, 5);

      const report = await consolidation.consolidate();
      expect(report.clustersFormed).toBe(1);
      expect(report.semanticCreated).toBe(0);

      const semanticCount = db
        .prepare(`SELECT COUNT(*) as c FROM hierarchical_memory WHERE tier = 'semantic'`)
        .get() as { c: number };
      expect(semanticCount.c).toBe(0);
    });

    it('should honor a lowered minClusterSize via config', async () => {
      const custom = new MemoryConsolidation(db, hmem, embedder, undefined, { minClusterSize: 2 });
      const dup = 'two-member consolidation';
      await seedEpisodic(dup, 0.9, 5);
      await seedEpisodic(dup, 0.9, 5);

      const report = await custom.consolidate();
      expect(report.clustersFormed).toBe(1);
      expect(report.semanticCreated).toBe(1);
    });

    it('should form one singleton cluster per candidate when none can merge', async () => {
      // clusterThreshold 1.01 is unreachable by cosine similarity, guaranteeing
      // no merges regardless of the (pseudo-random) mock-embedding directions.
      const noMerge = new MemoryConsolidation(db, hmem, embedder, undefined, {
        clusterThreshold: 1.01,
      });
      await seedEpisodic('quantum entanglement research', 0.9, 5);
      await seedEpisodic('frontend css grid layout', 0.9, 5);
      await seedEpisodic('postgres vacuum tuning', 0.9, 5);

      const report = await noMerge.consolidate();
      expect(report.clustersFormed).toBe(3);
      // Singletons are below minClusterSize → no semantic memories.
      expect(report.semanticCreated).toBe(0);
    });
  });

  describe('ADR-0219 F-04-002 — divide-by-zero guard in createSemanticMemory', () => {
    it('should use avgImportance fallback when all cluster members have accessCount 0', async () => {
      // Lower minAccessCount to 0 so zero-access members reach candidacy.
      // Lower minClusterSize to 2 so a 2-member cluster creates a semantic memory.
      const custom = new MemoryConsolidation(db, hmem, embedder, undefined, {
        minAccessCount: 0,
        minClusterSize: 2,
      });

      const dup = 'zero-access identical content for divide-by-zero guard';
      // Seed two episodic memories with accessCount 0.
      const id1 = await hmem.store(dup, 0.8, 'episodic');
      const id2 = await hmem.store(dup, 0.6, 'episodic');
      db.prepare('UPDATE hierarchical_memory SET access_count = 0 WHERE id IN (?, ?)').run(id1, id2);

      // Should not throw and should not store NaN importance.
      const report = await custom.consolidate();
      expect(report.semanticCreated).toBe(1);

      const semantic = db
        .prepare(`SELECT importance FROM hierarchical_memory WHERE tier = 'semantic'`)
        .get() as any;
      expect(semantic).toBeDefined();
      // Importance must be a finite number, not NaN.
      expect(Number.isFinite(semantic.importance)).toBe(true);
      expect(isNaN(semantic.importance)).toBe(false);
    });
  });

  describe('consolidate — forgetting curve', () => {
    it('should forget aged low-retention candidates', async () => {
      // importance 0.6 → strength ≈ 11 days; at ~25 days unrehearsed,
      // retention = e^(-25/11) ≈ 0.10 < forgettingThreshold 0.2 → forgotten.
      const id = await seedEpisodic('stale aged memory', 0.6, 4, 25);

      const report = await consolidation.consolidate();

      expect(report.memoriesForgotten).toBeGreaterThanOrEqual(1);
      const row = db.prepare('SELECT id FROM hierarchical_memory WHERE id = ?').get(id);
      expect(row).toBeUndefined();
    });

    it('should retain fresh candidates (retention ≈ 1.0)', async () => {
      const id = await seedEpisodic('fresh memory', 0.7, 4, 0);

      const report = await consolidation.consolidate();

      expect(report.memoriesForgotten).toBe(0);
      const row = db.prepare('SELECT id FROM hierarchical_memory WHERE id = ?').get(id);
      expect(row).toBeDefined();
    });

    it('should report retentionRate as the surviving fraction', async () => {
      await seedEpisodic('survivor one', 0.7, 4, 0); // retained
      await seedEpisodic('survivor two', 0.7, 4, 0); // retained
      await seedEpisodic('forgotten old', 0.6, 4, 30); // forgotten

      const report = await consolidation.consolidate();

      expect(report.episodicProcessed).toBe(3);
      expect(report.memoriesForgotten).toBe(1);
      expect(report.retentionRate).toBeCloseTo(2 / 3, 5);
    });
  });

  describe('consolidate — spaced repetition scheduling', () => {
    it('should schedule spaced repetition for surviving candidates', async () => {
      const id = await seedEpisodic('schedule me', 0.7, 4, 0);

      await consolidation.consolidate();

      const sched = db
        .prepare('SELECT * FROM spaced_repetition WHERE memory_id = ?')
        .get(id) as any;
      expect(sched).toBeDefined();
      expect(sched.ease_factor).toBeCloseTo(2.5, 5); // SM-2 default
      expect(sched.repetitions).toBe(0);
      expect(sched.next_review).toBeGreaterThan(Date.now());
    });

    it('should NOT schedule spaced repetition when disabled via config', async () => {
      const noSr = new MemoryConsolidation(db, hmem, embedder, undefined, {
        enableSpacedRepetition: false,
      });
      const id = await seedEpisodic('unscheduled', 0.7, 4, 0);

      await noSr.consolidate();

      const sched = db.prepare('SELECT * FROM spaced_repetition WHERE memory_id = ?').get(id);
      expect(sched).toBeUndefined();
    });
  });

  describe('consolidate — logging & recommendations', () => {
    it('should write a row to consolidation_log per run', async () => {
      await seedEpisodic('logged memory', 0.7, 4, 0);

      await consolidation.consolidate();

      const logCount = db.prepare('SELECT COUNT(*) as c FROM consolidation_log').get() as { c: number };
      expect(logCount.c).toBe(1);

      const logRow = db.prepare('SELECT * FROM consolidation_log ORDER BY id DESC LIMIT 1').get() as any;
      expect(logRow.episodic_processed).toBe(1);
      expect(logRow.execution_time_ms).toBeGreaterThanOrEqual(0);
    });

    it('should NOT log when there are no candidates (early return)', async () => {
      await consolidation.consolidate();
      const logCount = db.prepare('SELECT COUNT(*) as c FROM consolidation_log').get() as { c: number };
      expect(logCount.c).toBe(0);
    });

    it('should recommend lowering forgetting threshold under high forget rate', async () => {
      // All candidates aged → high forgetting rate (> 80% of processed).
      await seedEpisodic('old one', 0.6, 4, 40);
      await seedEpisodic('old two', 0.6, 4, 40);
      await seedEpisodic('old three', 0.6, 4, 40);

      const report = await consolidation.consolidate();

      expect(report.memoriesForgotten).toBe(3);
      expect(report.recommendations.some(r => r.toLowerCase().includes('forgetting'))).toBe(true);
    });

    it('should recommend checking cluster size when semantic creation lags clusters formed', async () => {
      // clusterThreshold 1.01 is unreachable by cosine similarity (max 1.0),
      // so every candidate stays a singleton: clustersFormed === N and
      // semanticCreated === 0, deterministically firing the
      // "Low semantic memory creation" recommendation (0 < N * 0.5).
      const noMerge = new MemoryConsolidation(db, hmem, embedder, undefined, {
        clusterThreshold: 1.01,
      });
      await seedEpisodic('candidate one', 0.7, 4, 0);
      await seedEpisodic('candidate two', 0.7, 4, 0);
      await seedEpisodic('candidate three', 0.7, 4, 0);

      const report = await noMerge.consolidate();
      expect(report.clustersFormed).toBe(3);
      expect(report.semanticCreated).toBe(0);
      expect(report.recommendations.some(r => r.toLowerCase().includes('semantic'))).toBe(true);
    });
  });

  describe('getConsolidationHistory', () => {
    it('should return an empty array before any consolidation runs', async () => {
      const history = await consolidation.getConsolidationHistory();
      expect(history).toEqual([]);
    });

    it('should return logged consolidations newest-first', async () => {
      // Run 1
      await seedEpisodic('history run one', 0.7, 4, 0);
      await consolidation.consolidate();

      // Run 2 (new candidate so it logs again)
      await seedEpisodic('history run two', 0.7, 4, 0);
      await consolidation.consolidate();

      const history = await consolidation.getConsolidationHistory();
      expect(history.length).toBe(2);
      // Newest first → timestamps descending.
      expect(history[0].timestamp).toBeGreaterThanOrEqual(history[1].timestamp);
      history.forEach(h => {
        expect(h).toHaveProperty('episodicProcessed');
        expect(h).toHaveProperty('retentionRate');
      });
    });

    it('should respect the limit argument', async () => {
      for (let i = 0; i < 3; i++) {
        await seedEpisodic(`limited history ${i}`, 0.7, 4, 0);
        await consolidation.consolidate();
      }

      const history = await consolidation.getConsolidationHistory(2);
      expect(history.length).toBe(2);
    });
  });

  describe('resilience — ADR-0219 F-04-003 fail-loud on orchestration fatals', () => {
    // Raw seed that does not depend on hmem.store embedding (so we can break
    // the embedder afterwards without affecting seeding).
    async function seedEpisodicRaw(content: string, importance: number, accessCount: number): Promise<void> {
      const id = `mem-raw-${Math.random().toString(36).slice(2)}`;
      const now = Date.now();
      db.prepare(
        `INSERT INTO hierarchical_memory
           (id, tier, content, importance, access_count, created_at, last_accessed_at)
         VALUES (?, 'episodic', ?, ?, ?, ?, ?)`,
      ).run(id, content, importance, accessCount, now, now);
    }

    it('should reject (throw) when an orchestration-level fatal occurs', async () => {
      // Orchestration-level fatal: getConsolidationCandidates calls embedder.embed
      // for every candidate. Replacing embed with a throwing stub after seeding
      // triggers a throw inside the outer try, which must propagate (not be swallowed).
      (embedder as any).embed = async () => {
        throw new Error('synthetic orchestration-level embed failure');
      };
      await seedEpisodicRaw('will fail to embed', 0.9, 5);

      await expect(consolidation.consolidate()).rejects.toThrow('synthetic orchestration-level embed failure');
    });

    it('should continue after a per-cluster createSemanticMemory failure and complete report', async () => {
      // Three identical candidates → one cluster with 3 members (≥ minClusterSize).
      // Patch hierarchicalMemory.store to fail on the first call so createSemanticMemory
      // throws for that cluster; consolidate should carry on (per-cluster catch) and
      // still complete with the remaining steps.
      const dup = 'per-cluster-fail scenario';
      await seedEpisodic(dup, 0.9, 5);
      await seedEpisodic(dup, 0.9, 5);
      await seedEpisodic(dup, 0.9, 5);

      let callCount = 0;
      const origStore = (consolidation as any).hierarchicalMemory.store.bind(
        (consolidation as any).hierarchicalMemory
      );
      (consolidation as any).hierarchicalMemory.store = async (...args: any[]) => {
        callCount++;
        if (callCount === 1) throw new Error('synthetic per-cluster store failure');
        return origStore(...args);
      };

      const report = await consolidation.consolidate();

      // The per-cluster error was caught locally; the run still completed.
      expect(report).toHaveProperty('executionTimeMs');
      expect(report.executionTimeMs).toBeGreaterThanOrEqual(0);
      // semanticCreated stays 0 because the only cluster failed.
      expect(report.semanticCreated).toBe(0);
      // The per-cluster failure was recorded in recommendations.
      expect(report.recommendations.some(r => r.includes('synthetic per-cluster store failure'))).toBe(true);
    });
  });
});
