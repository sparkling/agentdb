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

/**
 * Regression: the sql.js wrapper must honor the staging substrate's SAVEPOINT /
 * RELEASE / ROLLBACK TO lifecycle (ADR-0285 P3).
 *
 * The archivist staging substrate (src/archivist/staging-substrate.ts) wraps each
 * dispatch in `SAVEPOINT staging_<storeId>_<n>` and, on commit, `RELEASE`s it (on
 * rollback, `ROLLBACK TO` + `RELEASE`). A long-running sql.js daemon whose
 * NAMED-bind threw mid-dispatch (the P6 root cause pinned above) skipped the
 * matching RELEASE and left the savepoint counter desynced — so a later RELEASE
 * referenced a name that was never opened and SQLite raised
 * `no such savepoint: staging_agentdb_causal_edge_N` (the P3 symptom; reproduced
 * live on a stale pre-P6-fix daemon). With P6 fixed the mid-dispatch throw is
 * gone, so the open/release pairing stays balanced. These tests pin the sql.js
 * wrapper's SAVEPOINT handling on a fresh process (the better-sqlite3 acceptance
 * smoke cannot exercise the WASM path): the commit and rollback paths behave, and
 * an unbalanced RELEASE surfaces a REAL SQLite error — it is NOT swallowed into a
 * masked "Internal error".
 */
describe('db-fallback sql.js SAVEPOINT lifecycle (ADR-0285 P3 — staging substrate)', () => {
  let db: any;

  beforeEach(async () => {
    db = await createDatabase(':memory:');
    db.exec(DDL);
    db.exec(SEED);
  });

  afterEach(() => {
    if (db && typeof db.close === 'function') db.close();
  });

  it('SAVEPOINT → write → RELEASE commits the staged write', () => {
    db.exec('SAVEPOINT staging_agentdb_causal_edge_1');
    db.prepare(
      'INSERT INTO causal_edges (id, confidence, uplift, mechanism) VALUES (@id, @c, @u, @m)',
    ).run({ id: 10, c: 0.9, u: 0.6, m: 'sp-commit' });
    db.exec('RELEASE staging_agentdb_causal_edge_1'); // must NOT throw "no such savepoint"
    expect(
      db.prepare('SELECT mechanism FROM causal_edges WHERE id = @id').get({ id: 10 }).mechanism,
    ).toBe('sp-commit');
  });

  it('SAVEPOINT → write → ROLLBACK TO → RELEASE discards the staged write', () => {
    db.exec('SAVEPOINT staging_agentdb_causal_edge_2');
    db.prepare(
      'INSERT INTO causal_edges (id, confidence, uplift, mechanism) VALUES (@id, @c, @u, @m)',
    ).run({ id: 11, c: 0.9, u: 0.6, m: 'sp-rollback' });
    db.exec('ROLLBACK TO staging_agentdb_causal_edge_2');
    db.exec('RELEASE staging_agentdb_causal_edge_2'); // must NOT throw "no such savepoint"
    expect(db.prepare('SELECT id FROM causal_edges WHERE id = @id').get({ id: 11 })).toBeUndefined();
  });

  it('RELEASE of an unopened savepoint surfaces a real SQLite error (the P3 symptom is diagnosable, not masked)', () => {
    // A desynced open/release pairing (the live P3 symptom) must raise SQLite's
    // own "no such savepoint" — proving the wrapper does NOT swallow it into a
    // generic masked error. The desync itself is prevented upstream by the P6 fix.
    expect(() => db.exec('RELEASE staging_agentdb_causal_edge_99')).toThrow(/no such savepoint/i);
  });
});
