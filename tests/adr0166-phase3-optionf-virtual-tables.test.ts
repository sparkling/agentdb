/**
 * ADR-0166 Phase 3 (Option F) contract test
 *
 * Asserts that when sqlite-vec is loadable, AgentDB.initialize() creates
 * per-controller `<controller>_vec` virtual tables; when not loadable AND
 * user did NOT opt in, init proceeds in degraded mode (sqliteVecLoaded=false)
 * and the pre-Option-F path remains valid.
 *
 * The "if installed" branch is the load-bearing assertion; the "not installed"
 * branch documents degraded-mode contract.
 */

import { describe, it, expect } from 'vitest';
import { AgentDB } from '../src/core/AgentDB.js';

const EXPECTED_VEC_TABLES = [
  'hmem_vec',
  'consolidated_vec',
  'reflexion_episode_vec',
  'skill_vec',
  'reasoning_pattern_vec',
  'recall_vec',
  'learning_vec',
];

describe('ADR-0166 Phase 3 (Option F) — sqlite-vec virtual tables', () => {
  it('creates per-controller vec0 virtual tables when sqlite-vec loads', async () => {
    let sqliteVecAvailable = false;
    try {
      await import('sqlite-vec');
      sqliteVecAvailable = true;
    } catch {
      // Extension not installed on this platform — skip the load-bearing branch
    }

    if (!sqliteVecAvailable) {
      // Degraded-mode contract: init succeeds, sqliteVecLoaded is false,
      // no virtual tables created. No exception (user didn't opt in).
      const db = new AgentDB({});
      await db.initialize();
      expect(db.sqliteVecLoaded).toBe(false);
      return;
    }

    const db = new AgentDB({ vectorIndex: 'sqlite-vec' });
    await db.initialize();
    expect(db.sqliteVecLoaded).toBe(true);

    // Query sqlite_master to confirm each virtual table exists.
    const rawDb = (db as any).db;
    const stmt = rawDb.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    );
    for (const tableName of EXPECTED_VEC_TABLES) {
      const row = stmt.get(tableName);
      expect(row, `expected virtual table ${tableName} to exist`).toBeTruthy();
      expect((row as { name: string }).name).toBe(tableName);
    }
  });

  it('degrades cleanly when sqlite-vec is unavailable and user did not opt in', async () => {
    // Default config: no vectorIndex specified. Init succeeds either way;
    // sqliteVecLoaded reflects the actual outcome.
    const db = new AgentDB({});
    await db.initialize();
    expect(typeof db.sqliteVecLoaded).toBe('boolean');
  });
});
