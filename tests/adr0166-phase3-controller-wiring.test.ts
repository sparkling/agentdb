/**
 * ADR-0166 Phase 3 contract test — per-controller Option F wiring
 *
 * Asserts that when sqlite-vec is loaded, the augmented controllers'
 * INSERT path mirrors into the corresponding `<controller>_vec` virtual
 * table. Skipped gracefully when sqlite-vec is unavailable.
 */

import { describe, it, expect } from 'vitest';
import { AgentDB } from '../src/core/AgentDB.js';

async function sqliteVecAvailable(): Promise<boolean> {
  try {
    await import('sqlite-vec' as any);
    return true;
  } catch {
    return false;
  }
}

describe('ADR-0166 Phase 3 — per-controller Option F wiring', () => {
  it('HierarchicalMemory.store mirrors embedding into hmem_vec', async () => {
    if (!(await sqliteVecAvailable())) return;
    const db = new AgentDB({ vectorIndex: 'sqlite-vec' });
    await db.initialize();
    expect(db.sqliteVecLoaded).toBe(true);

    const hm: any = db.getController('hierarchicalMemory');
    const memoryId = await hm.store('test-content-hmem', 0.5, 'working');
    expect(typeof memoryId).toBe('string');

    const rawDb = (db as any).db;
    const rowCount = rawDb
      .prepare(`SELECT COUNT(*) AS c FROM hmem_vec WHERE id = ?`)
      .get(memoryId) as { c: number };
    expect(rowCount.c).toBe(1);
  });

  it('ReflexionMemory.storeEpisode mirrors into reflexion_episode_vec', async () => {
    if (!(await sqliteVecAvailable())) return;
    const db = new AgentDB({ vectorIndex: 'sqlite-vec' });
    await db.initialize();

    const reflexion: any = db.getController('reflexion');
    const episodeId = await reflexion.storeEpisode({
      sessionId: 'test-session-1',
      task: 'test-task',
      success: true,
    });
    expect(typeof episodeId).toBe('number');

    const rawDb = (db as any).db;
    const rowCount = rawDb
      .prepare(`SELECT COUNT(*) AS c FROM reflexion_episode_vec WHERE id = ?`)
      .get(String(episodeId)) as { c: number };
    expect(rowCount.c).toBe(1);
  });

  // ADR-0170 Phase B.3 (2026-05-11): SkillLibrary ported to PostgresBackend;
  // the `skill_vec` Option F mirror writes were dead-stripped atomically
  // with the port. This contract no longer applies — under postgres, vector
  // ops live alongside the row via pgvector (Phase C), not a sidecar
  // virtual table.
  it.skip('SkillLibrary.createSkill mirrors into skill_vec (RETIRED — ADR-0170 Phase B.3)', () => {
    /* intentionally skipped */
  });

  it('ReasoningBank.createPattern mirrors into reasoning_pattern_vec', async () => {
    if (!(await sqliteVecAvailable())) return;
    const db = new AgentDB({ vectorIndex: 'sqlite-vec' });
    await db.initialize();

    const reasoning: any = db.getController('reasoning');
    const patternId = await reasoning.createPattern({
      taskType: 'test-task-type',
      approach: 'test-approach',
      successRate: 0.8,
    });
    expect(typeof patternId).toBe('number');

    const rawDb = (db as any).db;
    const rowCount = rawDb
      .prepare(`SELECT COUNT(*) AS c FROM reasoning_pattern_vec WHERE id = ?`)
      .get(String(patternId)) as { c: number };
    expect(rowCount.c).toBe(1);
  });
});
