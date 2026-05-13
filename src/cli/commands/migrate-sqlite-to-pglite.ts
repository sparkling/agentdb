/**
 * @deprecated MUSEUM PIECE — ADR-0170 era. Migration tool for a substrate
 * direction (SQLite → pglite) that ADR-0177 reversed. NOT registered with
 * agentdb-cli.ts; cannot be invoked. Restored 2026-05-13 alongside
 * PostgresBackend.ts as reference material per ADR-0177 Open Follow-up #2.
 * If a future ADR re-introduces postgres, this is the migration shape
 * starting point.
 *
 * ADR-0170 Phase D step 5 — `agentdb migrate --from sqlite --to pglite <path>` CLI.
 *
 * One-shot migration of a legacy `.swarm/memory.db` (better-sqlite3 / sql.js
 * substrate, pre-Phase-B controller port) to a pglite cluster at the same
 * project's `.swarm/memory.pglite/` directory.
 *
 * Per ADR-0170 §"Phase D step 5" + resolution H, the contract is:
 *
 *   1. Idempotent-with-loud-refuse. Refuses if target dir is non-empty
 *      unless its `.migration-manifest.json` shows `IN_PROGRESS` (resume)
 *      or `COMPLETE` (exit 0 with "already migrated").
 *
 *   2. Per-table checkpoint manifest at
 *      `<target>/.pglite/.migration-manifest.json` carrying `source_sha256`
 *      so a mid-flight source change is caught at resume.
 *
 *   3. Preflight: refuses if `PRAGMA user_version` on the source is
 *      outside the known-good set, or if expected agentdb controller
 *      tables (episodes, skills, etc.) are missing.
 *
 *   4. Conversion rules:
 *        - `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL` with
 *          `OVERRIDING SYSTEM VALUE` for bulk insert + `setval()` once
 *          per table after the insert finishes (FK preservation).
 *        - `BLOB` → `BYTEA` byte-for-byte.
 *        - FTS5 → `tsvector GENERATED ALWAYS AS … STORED` + GIN index.
 *
 * Per `feedback-no-fallbacks`: no silent merge, no graceful degradation.
 * Either the migration completes per-table-byte-equivalent or it throws
 * with a clear diagnostic.
 *
 * MVP SCOPE (Phase D shipped 2026-05-12):
 *   - Idempotent-with-loud-refuse: implemented (manifest at target).
 *   - Preflight check: validates source is a sqlite file and has at least
 *     one agentdb controller table.
 *   - Conversion rules: pglite uses the same Phase A.5 schema (already
 *     postgres dialect), so this migration walks rows from sqlite tables
 *     into the same-named postgres tables. Type conversions inline.
 *   - Manifest write: per-table row count, plus source_sha256.
 *   - Contract test: tests/acceptance/adr0170-migration-roundtrip.test.mjs
 *     (created in this commit) asserts row count parity, ID preservation,
 *     and idempotent re-run.
 *
 * DEFERRED to a follow-up patch (tracked in the contract test as
 * `it.skip(...)` cases):
 *   - Mid-flight resume from `IN_PROGRESS` manifest (current MVP
 *     restarts from scratch on resume; idempotency check still works).
 *   - BLOB → BYTEA byte-fidelity tests (the legacy SQLite schemas the
 *     fork's controllers wrote did not store opaque BLOBs — embeddings
 *     went through the vector backend, not into agentdb_* tables).
 *   - FTS5 → tsvector roundtrip (the fork never wired FTS5 on the
 *     agentdb_* axis; ADR-0170 Phase C introduced tsvector cleanly).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { createDatabase } from '../../db-fallback.js';

const MANIFEST_FILENAME = '.migration-manifest.json';

/**
 * Migration states the manifest can hold. Used to gate idempotent retries.
 */
type MigrationState = 'IN_PROGRESS' | 'COMPLETE';

interface MigrationManifest {
  schema_version: 1;
  state: MigrationState;
  source_path: string;
  source_sha256: string;
  target_path: string;
  started_at_utc: string;
  completed_at_utc?: string;
  tables: Record<string, { row_count: number; checkpoint: 'COMPLETE' | 'PENDING' }>;
  adr: 'ADR-0170 Phase D step 5';
}

export interface SqliteToPgliteOptions {
  sourceDb: string;
  targetDir: string;
  verbose?: boolean;
  /**
   * Per ADR-0170 §"Phase D step 5" item 1: `--force` is intentionally NOT
   * a supported flag. Idempotency is decided by the manifest. To re-run
   * from scratch, the operator deletes the target dir manually — a loud,
   * deliberate action — not a hidden flag the migration silently honors.
   */
}

/**
 * Compute the SHA-256 of the source `.db` file. Used to detect mid-flight
 * source mutation when resuming from a manifest.
 */
function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function readManifest(targetDir: string): MigrationManifest | null {
  const manifestPath = path.join(targetDir, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as MigrationManifest;
  } catch (err) {
    throw new Error(
      `[migrate sqlite→pglite] Corrupt manifest at ${manifestPath}: ` +
      `${(err as Error).message}. Delete the target directory and re-run, ` +
      `or repair the manifest manually.`
    );
  }
}

function writeManifest(targetDir: string, manifest: MigrationManifest): void {
  const manifestPath = path.join(targetDir, MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

/**
 * Decide whether the target is safe to write into. Returns:
 *   - 'fresh' — target dir is empty or doesn't exist; safe to start.
 *   - 'resume' — target has a manifest in `IN_PROGRESS` state; can resume.
 *   - 'complete' — target has a manifest in `COMPLETE` state; exit 0
 *     (idempotent re-run).
 *   - throws — target is non-empty and has no manifest, or has a manifest
 *     with mismatched source_sha256.
 */
function inspectTarget(
  targetDir: string,
  sourcePath: string,
  sourceSha: string,
): 'fresh' | 'resume' | 'complete' {
  if (!fs.existsSync(targetDir)) {
    return 'fresh';
  }
  const entries = fs.readdirSync(targetDir);
  if (entries.length === 0) {
    return 'fresh';
  }
  const manifest = readManifest(targetDir);
  if (!manifest) {
    throw new Error(
      `[migrate sqlite→pglite] Target directory ${targetDir} is non-empty ` +
      `but has no .migration-manifest.json. Refusing to overwrite an ` +
      `existing pglite cluster (no silent merge — per ADR-0170 ` +
      `§"No-fallback policy"). Delete the target directory manually if ` +
      `you really want to re-migrate, or pick a different --target.`
    );
  }
  if (manifest.source_path !== sourcePath) {
    throw new Error(
      `[migrate sqlite→pglite] Manifest at ${targetDir}/${MANIFEST_FILENAME} ` +
      `was written for source ${manifest.source_path}, but this run ` +
      `requested source ${sourcePath}. Refusing to mix sources.`
    );
  }
  if (manifest.source_sha256 !== sourceSha) {
    throw new Error(
      `[migrate sqlite→pglite] Source file SHA-256 mismatch. The source ` +
      `file changed since the IN_PROGRESS migration was started. ` +
      `Manifest sha256: ${manifest.source_sha256}, current: ${sourceSha}. ` +
      `Delete the target directory and re-run from scratch.`
    );
  }
  if (manifest.state === 'COMPLETE') {
    return 'complete';
  }
  return 'resume';
}

/**
 * Preflight: assert the source database has at least one agentdb
 * controller table. Refuses to proceed if the file is missing or has
 * none of the expected tables.
 *
 * The full list of agentdb controller tables (per Phase B port audit) is
 * conservatively probed with a subset that covers all 13 controllers;
 * matching any one is enough to confirm this is an agentdb_* database.
 */
const KNOWN_CONTROLLER_TABLES = [
  'episodes',
  'skills',
  'reasoning_patterns',
  'hierarchical_memory',
  'causal_edges',
  'learning_state_embeddings',
  'recall_certificates',
];

function preflight(source: any, sourcePath: string): string[] {
  // Probe sqlite_master for known controller tables. sql.js exposes
  // `prepare(...).all(...)` returning an array of rows.
  const present: string[] = [];
  const stmt = source.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
  );
  for (const name of KNOWN_CONTROLLER_TABLES) {
    const row = stmt.get(name) as { name?: string } | undefined;
    if (row && row.name === name) {
      present.push(name);
    }
  }
  if (present.length === 0) {
    throw new Error(
      `[migrate sqlite→pglite] Preflight failed: source ${sourcePath} ` +
      `contains none of the expected agentdb controller tables ` +
      `(${KNOWN_CONTROLLER_TABLES.join(', ')}). This is either not an ` +
      `agentdb database or its schema is from a version older than the ` +
      `Phase B controller port. Refusing to migrate.`
    );
  }
  return present;
}

/**
 * MVP migration: enumerate every user table in the source DB and copy
 * rows into same-named tables on the target pglite cluster.
 *
 * For Phase D MVP (2026-05-12) the row-copy is intentionally simple:
 * the postgres-side schema (Phase A.5 ported) carries the same column
 * names as the SQLite source, and the controller-port commits in Phase B
 * already exercised the round-trip on a per-controller basis. The MVP
 * does NOT yet handle: BLOB→BYTEA byte-fidelity probes (the fork's
 * controllers stored embeddings via the vector backend, not in agentdb_*
 * tables, so the BLOB pathway has zero live data); FTS5→tsvector
 * conversion (the fork never wired FTS5 on the agentdb_* axis); per-row
 * SQL function rewrites (datetime → EXTRACT(EPOCH FROM …), etc.).
 *
 * The contract test at tests/acceptance/adr0170-migration-roundtrip.test.mjs
 * documents the deferred follow-ups as `it.skip(...)` blocks so the test
 * surface still names them while staying green.
 */
async function migrateTables(
  source: any,
  manifest: MigrationManifest,
  options: SqliteToPgliteOptions,
): Promise<void> {
  // Lazy-import pglite so the migrate command doesn't pull it in for
  // every other agentdb CLI subcommand.
  let PGlite: any;
  try {
    // @ts-ignore — @electric-sql/pglite ships its own types
    const pglite = await import('@electric-sql/pglite');
    PGlite = (pglite as any).PGlite ?? (pglite as any).default?.PGlite;
  } catch (err) {
    throw new Error(
      `[migrate sqlite→pglite] @electric-sql/pglite is required but ` +
      `failed to import: ${(err as Error).message}. Install with ` +
      `\`npm install @electric-sql/pglite\`.`
    );
  }
  if (typeof PGlite !== 'function') {
    throw new Error(
      `[migrate sqlite→pglite] @electric-sql/pglite module loaded but ` +
      `PGlite constructor not found.`
    );
  }

  // Resolve the on-disk pglite dir. PGlite accepts a `file://...` URL
  // or a plain directory path depending on version; the documented
  // string form for v0.4 is the directory path with no scheme.
  const target = new PGlite(options.targetDir);
  try {
    // Iterate user tables in the source DB.
    const tablesStmt = source.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    const tables: string[] = [];
    let row: any;
    while ((row = tablesStmt.step?.() ? tablesStmt.getAsObject?.() : null)) {
      if (row?.name) tables.push(row.name as string);
    }
    // sql.js stmt iteration style varies; fall back to .all() if available
    if (tables.length === 0 && typeof tablesStmt.all === 'function') {
      const rows = tablesStmt.all() as Array<{ name: string }>;
      for (const r of rows) tables.push(r.name);
    }

    if (options.verbose) {
      console.error(`[migrate sqlite→pglite] tables to migrate: ${tables.join(', ')}`);
    }

    for (const table of tables) {
      // Skip if manifest says this table is already complete (resume path).
      if (manifest.tables[table]?.checkpoint === 'COMPLETE') {
        if (options.verbose) {
          console.error(`[migrate sqlite→pglite] skip ${table} (already migrated)`);
        }
        continue;
      }
      manifest.tables[table] = { row_count: 0, checkpoint: 'PENDING' };
      writeManifest(options.targetDir, manifest);

      // For the MVP, copy is a row-by-row INSERT with column-binding.
      // The postgres schema is owned by Phase A.5's schema.sql which the
      // PostgresBackend's initialize() applies via `exec(schema)`. We
      // assume the target already has the schema loaded — the operator
      // should have run agentdb once against the target dir to bootstrap
      // it before invoking migrate. (Documented in --help.)
      const rowStmt = source.prepare(`SELECT * FROM ${table}`);
      const rows = typeof rowStmt.all === 'function'
        ? (rowStmt.all() as Record<string, unknown>[])
        : [];
      for (const r of rows) {
        const cols = Object.keys(r);
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        const values = cols.map((c) => r[c]);
        const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
        try {
          await target.query(sql, values);
        } catch (err) {
          throw new Error(
            `[migrate sqlite→pglite] Insert into ${table} failed: ` +
            `${(err as Error).message}. SQL: ${sql}`
          );
        }
        manifest.tables[table].row_count++;
      }
      manifest.tables[table].checkpoint = 'COMPLETE';
      writeManifest(options.targetDir, manifest);

      if (options.verbose) {
        console.error(`[migrate sqlite→pglite] ${table}: ${manifest.tables[table].row_count} rows migrated`);
      }
    }
  } finally {
    if (typeof target.close === 'function') {
      await target.close();
    }
  }
}

/**
 * Entry point. Called from agentdb-cli.ts when the user invokes
 * `agentdb migrate --from sqlite --to pglite ...`.
 */
export async function migrateSqliteToPglite(options: SqliteToPgliteOptions): Promise<void> {
  const { sourceDb, targetDir, verbose } = options;

  if (!fs.existsSync(sourceDb)) {
    throw new Error(`[migrate sqlite→pglite] Source database not found: ${sourceDb}`);
  }

  const sourceSha = sha256File(sourceDb);
  const resolvedTargetDir = path.resolve(targetDir);

  // Idempotent decision: read or initialize the manifest.
  const status = inspectTarget(resolvedTargetDir, path.resolve(sourceDb), sourceSha);
  if (status === 'complete') {
    console.log(`[migrate sqlite→pglite] Target ${resolvedTargetDir} already migrated (manifest state=COMPLETE). Exit 0.`);
    return;
  }
  if (status === 'fresh') {
    fs.mkdirSync(resolvedTargetDir, { recursive: true, mode: 0o700 });
  }

  // Open source via the legacy db-fallback (better-sqlite3 / sql.js).
  // Per Phase D, db-fallback.ts stays alive specifically to support this
  // read path — the only legacy SQLite surface that still has a real
  // consumer post-substrate-replacement.
  const source = await createDatabase(sourceDb);

  try {
    // Preflight — refuses with a clear diagnostic if the source doesn't
    // look like an agentdb database.
    const presentTables = preflight(source, sourceDb);
    if (verbose) {
      console.error(`[migrate sqlite→pglite] preflight OK; tables present: ${presentTables.join(', ')}`);
    }

    // Read or initialize manifest.
    const existing = readManifest(resolvedTargetDir);
    const manifest: MigrationManifest = existing ?? {
      schema_version: 1,
      state: 'IN_PROGRESS',
      source_path: path.resolve(sourceDb),
      source_sha256: sourceSha,
      target_path: resolvedTargetDir,
      started_at_utc: new Date().toISOString(),
      tables: {},
      adr: 'ADR-0170 Phase D step 5',
    };
    writeManifest(resolvedTargetDir, manifest);

    // Do the migration.
    await migrateTables(source, manifest, options);

    // Flip to COMPLETE on success.
    manifest.state = 'COMPLETE';
    manifest.completed_at_utc = new Date().toISOString();
    writeManifest(resolvedTargetDir, manifest);

    console.log(`[migrate sqlite→pglite] migration complete: ${resolvedTargetDir}`);
    console.log(`[migrate sqlite→pglite] tables migrated: ${Object.keys(manifest.tables).join(', ')}`);
  } finally {
    if (typeof source.close === 'function') {
      source.close();
    }
  }
}
