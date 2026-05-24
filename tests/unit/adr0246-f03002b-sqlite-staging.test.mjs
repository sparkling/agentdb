/**
 * ADR-0246 F-03-002 path (b) — SQLite staging enforcement.
 *
 * Extends Batch 1's FS-JSON staging (path a) to the SQLite carve-out
 * substrate. The staging substrate opens an outer SAVEPOINT around the
 * dispatch handler — every INSERT/UPDATE landing on the shared
 * `better-sqlite3` handle (whether via `handle.db.prepare(...).run()`
 * or via capability writers that share the same handle per ADR-0166)
 * lands inside the savepoint. On invariant violation, `rollback()` does
 * `ROLLBACK TO SAVEPOINT` + `RELEASE SAVEPOINT`, undoing every write
 * that happened during the dispatch. On commit, `RELEASE SAVEPOINT`.
 *
 * Test approach:
 *   - Real `better-sqlite3` database at a temp path.
 *   - Real `Archivist` initialized with the SQLite db.
 *   - Custom mutation handler + invariant registered for the test —
 *     the handler does `handle.db.prepare('INSERT ...').run(...)`; the
 *     invariant always rejects.
 *   - Assert:
 *       (i) dispatch throws with the invariant violation.
 *       (ii) `SELECT count(*)` over the test table is 0 — no INSERT
 *            survived the rollback.
 *
 * Per ADR-0246 §"Test discipline tightened" — real substrate, NOT a mock.
 * Per Expert 4 (swarm review) — no in-memory mock substrates.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { Archivist } from '../../src/archivist/index.js';
import { __resetRegistry__, registerMutationHandler } from '../../src/archivist/registration.js';

// A SQLite carve-out storeId — these route through the sqliteSubstrate per
// ADR-0166 (substrate-registry.ts SQLITE_CARVE_OUT_STORE_IDS roster).
const TEST_TOOL = 'agentdb_hierarchical_store';

let scratchDir;
let dbPath;
let db;

beforeEach(() => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr0246-f03002b-sqlite-'));
  dbPath = path.join(scratchDir, 'staging-test.db');
  db = new Database(dbPath);
  // Create a minimal test table — the SAVEPOINT covers INSERTs into any
  // table on this db handle, so the schema details don't matter beyond
  // having a table to write into.
  db.prepare('CREATE TABLE staging_test (id TEXT PRIMARY KEY, payload TEXT)').run();
  __resetRegistry__();
});

afterEach(() => {
  __resetRegistry__();
  try {
    db?.close();
  } catch {
    // ignore
  }
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('ADR-0246 F-03-002 path (b): SQLite staging enforcement', () => {
  it('invariant violation ROLLBACK TO SAVEPOINT undoes the INSERT', async () => {
    // ── Phase 1: register a test handler that does a SQLite INSERT ──
    // The invariant ALWAYS rejects so we exercise the rollback path.
    registerMutationHandler(
      TEST_TOOL,
      async (ctx, payload) => {
        await ctx.substrate.withWrite({ storeId: TEST_TOOL }, async (handle) => {
          // The staging substrate wraps the handler in an outer SAVEPOINT;
          // the INSERT below lands inside it. On rollback, it is undone.
          const sqliteHandle = handle;
          sqliteHandle.db.prepare('INSERT INTO staging_test (id, payload) VALUES (?, ?)').run(
            payload.key,
            JSON.stringify({ value: payload.value, tier: payload.tier }),
          );
        });
      },
      {
        invariants: [
          // Always-rejecting invariant — simulates the F-03-002 repro shape.
          () => ({ violated: true, detail: 'test invariant always rejects (ADR-0246 F-03-002 path b sqlite)' }),
        ],
      },
    );

    // ── Phase 2: bring up the archivist with the SQLite db ──
    const archivist = new Archivist();
    await archivist.initialize({
      projectRoot: scratchDir,
      sqliteDb: db,
    });

    // ── Phase 3: dispatch — must throw because the invariant rejects ──
    await expect(
      archivist.dispatch(TEST_TOOL, {
        key: 'should-not-persist',
        value: 'invariant-violator',
        tier: 'working',
      }),
    ).rejects.toThrow(/test invariant always rejects/);

    // ── Phase 4: prove the INSERT never committed ──
    // The SAVEPOINT was rolled back; the row should not exist.
    const rows = db.prepare('SELECT count(*) AS n FROM staging_test').get();
    expect(rows.n).toBe(0);
  });

  it('passing invariants RELEASE the savepoint and commit the INSERT', async () => {
    // Mirror test asserting the happy path still commits — staging must
    // not regress the existing pass-through behavior.
    registerMutationHandler(
      TEST_TOOL,
      async (ctx, payload) => {
        await ctx.substrate.withWrite({ storeId: TEST_TOOL }, async (handle) => {
          const sqliteHandle = handle;
          // The handler maps payload.key → row id (mirrors the hierarchical_store
          // contract). The savepoint covers this INSERT.
          sqliteHandle.db.prepare('INSERT INTO staging_test (id, payload) VALUES (?, ?)').run(
            payload.key,
            JSON.stringify({ value: payload.value, tier: payload.tier }),
          );
        });
      },
      {
        invariants: [() => 'pass'],
      },
    );

    const archivist = new Archivist();
    await archivist.initialize({
      projectRoot: scratchDir,
      sqliteDb: db,
    });

    await archivist.dispatch(TEST_TOOL, {
      key: 'should-persist',
      value: 'happy-path',
      tier: 'working',
    });

    const rows = db.prepare('SELECT count(*) AS n FROM staging_test').get();
    expect(rows.n).toBe(1);
    const stored = db.prepare("SELECT id, payload FROM staging_test WHERE id = ?").get('should-persist');
    expect(stored).toBeDefined();
    expect(stored.id).toBe('should-persist');
  });

  it('handler throw also ROLLBACKs the savepoint', async () => {
    // The dispatch path's catch arm calls staging.rollback() so a handler
    // that throws AFTER the INSERT (but BEFORE returning) does not commit
    // the staged work either.
    registerMutationHandler(
      TEST_TOOL,
      async (ctx, payload) => {
        await ctx.substrate.withWrite({ storeId: TEST_TOOL }, async (handle) => {
          const sqliteHandle = handle;
          sqliteHandle.db.prepare('INSERT INTO staging_test (id, payload) VALUES (?, ?)').run(
            payload.key,
            JSON.stringify({ value: payload.value, tier: payload.tier }),
          );
          throw new Error('handler-throw-after-insert');
        });
      },
      {
        invariants: [() => 'pass'],
      },
    );

    const archivist = new Archivist();
    await archivist.initialize({
      projectRoot: scratchDir,
      sqliteDb: db,
    });

    await expect(
      archivist.dispatch(TEST_TOOL, {
        key: 'should-not-persist-on-throw',
        value: 'throw-path',
        tier: 'working',
      }),
    ).rejects.toThrow(/handler-throw-after-insert/);

    const rows = db.prepare('SELECT count(*) AS n FROM staging_test').get();
    expect(rows.n).toBe(0);
  });
});
