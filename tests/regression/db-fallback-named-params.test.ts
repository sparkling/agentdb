/**
 * Regression: sql.js fallback must honor better-sqlite3 NAMED-parameter binding.
 *
 * The archivist's SQLite carve-out read path (causal-recall / hierarchical-recall
 * handlers) calls `stmt.all({ minConfidence, limit, ... })` — a single plain
 * object of BARE-keyed named params, the better-sqlite3 convention. When AgentDB
 * runs on the sql.js (WASM) fallback (no native better-sqlite3 build), the
 * wrapper's `all`/`get`/`run` used to `stmt.bind(restArray)`, so the object
 * arrived as `[{…}]` and sql.js bound it POSITIONALLY, throwing the WASM string
 * `Wrong API use : tried to bind a value of an unknown type ([object Object])`.
 * That string is not an Error instance, so the cli's `sanitizeError()` flattened
 * it to a generic "Internal error" — exactly the P6 symptom on
 * `agentdb_causal-recall` / `agentdb_hierarchical-recall` (ADR-0285).
 *
 * `bindSqlJsParams` routes a single plain-object arg to sql.js named binding
 * (re-keyed with the placeholder's sigil) and positional args to array binding.
 * These tests pin both wrappers (`createDatabase` → createSqlJsWrapper, and
 * `wrapExistingSqlJsDatabase`) against the regressed and adjacent shapes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, wrapExistingSqlJsDatabase } from '../../src/db-fallback.js';

// Seed shape mirrors the carve-out tables the recall handlers read.
const DDL = `CREATE TABLE causal_edges (
  id INTEGER PRIMARY KEY,
  confidence REAL,
  uplift REAL,
  mechanism TEXT
)`;
const SEED = `INSERT INTO causal_edges (id, confidence, uplift, mechanism) VALUES
  (1, 1.0, 0.5, 'depends-on'),
  (2, 1.0, 0.3, 'supersedes'),
  (3, 0.4, 0.1, 'weak-edge')`;

// The causal-recall handler's SQL shape: @named params, a nullable @likeQuery.
const NAMED_SQL = `SELECT id FROM causal_edges
  WHERE confidence >= @minConfidence
    AND (@likeQuery IS NULL OR mechanism IS NULL OR mechanism LIKE @likeQuery)
  ORDER BY uplift DESC, id ASC
  LIMIT @limit`;

describe('db-fallback sql.js NAMED-parameter binding (ADR-0285 P6 regression)', () => {
  describe('createDatabase / createSqlJsWrapper', () => {
    let db: any;

    beforeEach(async () => {
      db = await createDatabase(':memory:');
      db.exec(DDL);
      db.exec(SEED);
    });

    afterEach(() => {
      if (db && typeof db.close === 'function') db.close();
    });

    it('all(): binds a bare-keyed named-params OBJECT (the regressed case)', () => {
      // Before the fix this threw the WASM "unknown type ([object Object])" string.
      const rows = db.prepare(NAMED_SQL).all({ minConfidence: 0.6, likeQuery: null, limit: 5 });
      // confidence>=0.6 ⇒ ids 1 and 2 (id 3 has confidence 0.4); ordered by uplift desc.
      expect(rows.map((r: any) => r.id)).toEqual([1, 2]);
    });

    it('all(): named LIKE filter selects by mechanism', () => {
      const rows = db
        .prepare(NAMED_SQL)
        .all({ minConfidence: 0.0, likeQuery: '%depends%', limit: 5 });
      expect(rows.map((r: any) => r.id)).toEqual([1]);
    });

    it('get(): binds a named-params OBJECT and returns one row', () => {
      const row = db
        .prepare('SELECT id, mechanism FROM causal_edges WHERE id = @id')
        .get({ id: 2 });
      expect(row).toMatchObject({ id: 2, mechanism: 'supersedes' });
    });

    it('run(): INSERT with a named-params OBJECT persists the row', () => {
      db.prepare(
        'INSERT INTO causal_edges (id, confidence, uplift, mechanism) VALUES (@id, @c, @u, @m)',
      ).run({ id: 9, c: 0.9, u: 0.7, m: 'fresh-edge' });
      const row = db.prepare('SELECT mechanism FROM causal_edges WHERE id = @id').get({ id: 9 });
      expect(row.mechanism).toBe('fresh-edge');
    });

    it('all(): POSITIONAL binding still works', () => {
      const rows = db
        .prepare('SELECT id FROM causal_edges WHERE confidence >= ? ORDER BY id LIMIT ?')
        .all(0.6, 5);
      expect(rows.map((r: any) => r.id)).toEqual([1, 2]);
    });

    it('all(): no params returns every row', () => {
      const rows = db.prepare('SELECT id FROM causal_edges ORDER BY id').all();
      expect(rows.map((r: any) => r.id)).toEqual([1, 2, 3]);
    });
  });

  describe('wrapExistingSqlJsDatabase (unified-mode shared handle)', () => {
    let raw: any;
    let db: any;

    beforeEach(async () => {
      // Reach the raw sql.js Database, then wrap it the way unified mode does.
      const inner = await createDatabase(':memory:');
      raw = (inner as any).db;
      raw.run(DDL);
      raw.run(SEED);
      db = wrapExistingSqlJsDatabase(raw, ':memory:');
    });

    it('all(): binds a bare-keyed named-params OBJECT (the regressed case)', () => {
      const rows = db.prepare(NAMED_SQL).all({ minConfidence: 0.6, likeQuery: null, limit: 5 });
      expect(rows.map((r: any) => r.id)).toEqual([1, 2]);
    });

    it('all(): POSITIONAL binding still works', () => {
      const rows = db
        .prepare('SELECT id FROM causal_edges WHERE confidence >= ? ORDER BY id LIMIT ?')
        .all(0.6, 5);
      expect(rows.map((r: any) => r.id)).toEqual([1, 2]);
    });
  });
});
