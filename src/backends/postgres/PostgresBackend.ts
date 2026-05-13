/**
 * @deprecated MUSEUM PIECE — ADR-0170 era. Substrate retired by ADR-0177
 * (RVF-first single-node fork). NOT wired into factory.ts / AgentDB.ts /
 * controller-registry.ts. Restored 2026-05-13 per ADR-0177 Open Follow-up #2
 * resolution as a reference for the future @ruvector PG extension hook
 * (Open Follow-up #5). `pg` + `@electric-sql/pglite` are NOT in package.json;
 * dynamic imports throw at initialize() with install instructions if anything
 * tries to construct this class. DO NOT wire this back without a new ADR.
 *
 * PostgresBackend - PostgreSQL substrate for AgentDB (ADR-0170 Phase A)
 *
 * Implements the relational substrate for the agentdb_* axis on PostgreSQL.
 * Two connection modes, selected at construction time:
 *
 *   1. Embedded (pglite) — default when `connectionString` is unset. WASM
 *      postgres 15 running in-process; persists a real PG cluster (PG_VERSION
 *      bearing dir) to `<dataDir>/`. Drop-in replacement for SQLite's
 *      embedded portability story.
 *
 *   2. Server (pg) — opt-in when `AGENTDB_POSTGRES_URL` env or
 *      `config.connectionString` is set. Connects via node-postgres to a
 *      real PostgreSQL deployment.
 *
 * Fail-loud policy (ADR-0170 §"No-fallback policy" + memory
 * `feedback-no-fallbacks`):
 *
 *   - If embedded mode and `import('@electric-sql/pglite')` fails → throw.
 *     Never silently downgrade to sql.js/better-sqlite3.
 *   - If server mode and connection setup fails → throw with the requested
 *     URL surfaced. Never silently downgrade to embedded mode.
 *   - If legacy `<dataDir>/.db` SQLite file detected → throw and point
 *     users at the one-shot `agentdb migrate --from sqlite --to pglite`
 *     CLI (Phase D). No auto-migration.
 *
 * DataDir resolution (per `/tmp/adr0170-resolution-I.md`):
 *
 *   - If `connectionString` set → server mode, no dataDir.
 *   - Else if `config.dataDir` set explicitly → use verbatim.
 *   - Else → default `${process.cwd()}/.swarm/memory.pglite/`.
 *
 * The default routes repeated CLI invocations in the same project dir to
 * the warm-reopen path (~94 ms per `/tmp/adr0170-resolution-I.md` cold-start
 * profiling), not the cold-init path (~673 ms).
 *
 * NOTE: This backend implements VectorBackend for the factory-detection
 * interface compatibility, but the postgres world's vector ops are
 * first-class column types (pgvector) integrated with the relational
 * planner — see Phase C for the in-row k-NN integration. Phase A focuses
 * on substrate plumbing; this backend is wired to throw on insert/search
 * calls until pgvector tables are created in Phase C. Controllers do not
 * route through VectorBackend.insert/search() — they call this.db.query()
 * directly.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  VectorBackend,
  VectorConfig,
  SearchResult,
  SearchOptions,
  VectorStats,
} from '../VectorBackend.js';

/**
 * Resolve the dataDir for embedded (pglite) mode.
 *
 * Per ADR-0170 §Phase A item 7 (gap-I resolution):
 *   - If connectionString is set → server mode, no dataDir.
 *   - Else if config.dataDir is set explicitly → use verbatim.
 *   - Else → ${process.cwd()}/.swarm/memory.pglite/
 *
 * `process.cwd()` is the closest analog to "projectRoot" available without
 * importing a project-config module. Callers that need a different root
 * pass `config.dataDir` explicitly.
 */
export function resolveDataDir(config: PostgresBackendConfig): string | null {
  if (config.connectionString) return null;
  if (config.dataDir) return config.dataDir;
  return path.join(process.cwd(), '.swarm', 'memory.pglite');
}

export interface PostgresBackendConfig extends VectorConfig {
  /**
   * PostgreSQL connection string (e.g., `postgres://user:pass@host:port/db`).
   * When set, the backend runs in server mode via `pg`. When unset, runs
   * in embedded mode via `@electric-sql/pglite`.
   *
   * Can also be supplied via the `AGENTDB_POSTGRES_URL` env var (the
   * constructor checks both, preferring the explicit config field).
   */
  connectionString?: string;

  /**
   * Embedded-mode persistence directory. Ignored when `connectionString`
   * is set. When unset, defaults to `${cwd}/.swarm/memory.pglite/` per
   * the gap-I resolution.
   */
  dataDir?: string;
}

type PgliteClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
  ready: Promise<void>;
};

type PgServerClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  end: () => Promise<void>;
  connect: () => Promise<void>;
};

/**
 * Convert a Float32Array embedding to pgvector's text literal format.
 *
 * pgvector accepts vector values as a text-format array literal:
 *   '[0.1, 0.2, 0.3, …]'::vector
 *
 * Both pglite and node-postgres bind text-format values transparently when
 * the column type is `vector(N)`, so passing the string through
 * `query(sql, [embeddingToVector(emb)])` lands correctly without a cast.
 *
 * (ADR-0170 Phase C.1)
 */
export function embeddingToVector(embedding: Float32Array | number[]): string {
  const arr = embedding instanceof Float32Array ? Array.from(embedding) : embedding;
  // Postgres-side `vector` parser is strict about non-finite floats — reject
  // NaN/Inf at the boundary to surface bugs early instead of at INSERT time.
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) {
      throw new Error(
        `[PostgresBackend.embeddingToVector] non-finite value at index ${i}: ${arr[i]}`,
      );
    }
  }
  return `[${arr.join(',')}]`;
}

/**
 * Parse a pgvector text-format value back to Float32Array.
 *
 * pglite/pg surface `vector` columns as a JS string ('[0.1,0.2,…]') unless
 * a custom type parser is registered. This helper handles both shapes:
 * already-an-array (custom parser registered) and raw text literal.
 *
 * (ADR-0170 Phase C.1)
 */
export function vectorToEmbedding(value: unknown): Float32Array {
  if (value instanceof Float32Array) return value;
  if (Array.isArray(value)) {
    return Float32Array.from(value as number[]);
  }
  if (typeof value === 'string') {
    // Strip the brackets, then split. Empty `[]` returns a 0-length array.
    const trimmed = value.replace(/^\[/, '').replace(/\]$/, '').trim();
    if (trimmed.length === 0) return new Float32Array(0);
    const parts = trimmed.split(',').map((s) => Number(s.trim()));
    return Float32Array.from(parts);
  }
  throw new Error(
    `[PostgresBackend.vectorToEmbedding] unsupported value type ${typeof value}: ${String(value)}`,
  );
}

/**
 * PostgresBackend — substrate-aware client for the agentdb_* axis.
 *
 * Currently implements the VectorBackend interface for factory
 * compatibility, but most methods throw `PHASE_A_VECTOR_OPS_DEFERRED`
 * until Phase C's pgvector integration. Controllers consume `.client`
 * directly for `query(sql, params)`.
 */
export class PostgresBackend implements VectorBackend {
  readonly name = 'rvf' as const; // VectorBackend.name is unioned to existing values; postgres is a SUBSTRATE not a vector index. Phase C widens the type when pgvector lands.

  private config: PostgresBackendConfig;
  private mode: 'embedded' | 'server';
  private dataDir: string | null;
  private connectionString: string | null;
  private _client: PgliteClient | PgServerClient | null = null;
  private initialized = false;

  constructor(config: PostgresBackendConfig = { metric: 'cosine' }) {
    this.config = config;

    // Resolve mode based on connectionString (config or env), then check
    // for the legacy `.db` SQLite file *before* doing any import work so
    // the error path is fast and obvious.
    const envUrl = process.env.AGENTDB_POSTGRES_URL;
    this.connectionString = config.connectionString ?? envUrl ?? null;
    this.mode = this.connectionString ? 'server' : 'embedded';
    this.dataDir = resolveDataDir(config);

    // Legacy SQLite detection: if the embedded dataDir's parent dir holds
    // a `memory.db` (the SQLite path), throw with the migration hint.
    // Same check applies in server mode — if a project has a stale
    // memory.db sitting next to a freshly-set AGENTDB_POSTGRES_URL, the
    // user almost certainly intended one substrate not both.
    this.assertNoLegacySqliteFile();
  }

  /**
   * Lazy initializer — separate from the constructor so the failure mode
   * is observable as a rejected Promise rather than a synchronous throw
   * from constructor land (the rest of the codebase opens AgentDB via
   * `await backend.initialize()`).
   *
   * Errors thrown here are FATAL per ADR-0170 §"No-fallback policy".
   * Never caught-and-degraded.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.mode === 'embedded') {
      await this.initEmbedded();
    } else {
      await this.initServer();
    }

    this.initialized = true;
  }

  /**
   * Embedded mode: import pglite, ensure dataDir exists, construct PGlite
   * **with the pgvector extension**, wait for `ready`. Fail loud on any
   * import or construction error.
   *
   * ADR-0170 Phase C.1: pgvector loaded at construction time via the
   * `extensions: { vector }` PGliteOptions field. After ready resolves,
   * the cluster has the extension binary linked but the schema-level
   * `CREATE EXTENSION vector` is run once in `enableVectorExtension()`
   * before the first DDL touches a `vector(N)` column.
   */
  private async initEmbedded(): Promise<void> {
    if (!this.dataDir) {
      throw new Error(
        '[PostgresBackend] Embedded mode requires a dataDir; resolveDataDir() returned null. ' +
          'This is an internal invariant violation — embedded mode is selected only when ' +
          'connectionString is unset, in which case dataDir always resolves to a path.',
      );
    }

    // Ensure parent dir exists (pglite handles creation of its own
    // contents — PG_VERSION, base/, pg_wal/, etc. — but the immediate
    // parent must exist).
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
    } catch (err) {
      throw new Error(
        `[PostgresBackend] Cannot create embedded pglite dataDir at "${this.dataDir}": ` +
          `${(err as Error).message}`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let PGlite: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let vectorExt: any;
    try {
      // pglite uses CommonJS/ESM hybrid; the constructor is on the
      // `PGlite` named export. We import via dynamic import to keep the
      // backend lazy-loadable.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import('@electric-sql/pglite');
      PGlite = mod.PGlite ?? mod.default?.PGlite;
      if (typeof PGlite !== 'function') {
        throw new Error('pglite module loaded but PGlite export not found');
      }
    } catch (err) {
      throw new Error(
        `Cannot initialize AgentDB: pglite unavailable and no connectionString provided. ` +
          `Underlying error: ${(err as Error).message}. ` +
          `Install with: npm install @electric-sql/pglite`,
      );
    }

    // pgvector extension is shipped with @electric-sql/pglite as a
    // subpath export. Fail-loud if the subpath is missing — we don't
    // silently degrade to BYTEA columns.
    try {
      // The pglite vector subpath has no @types declaration shipped with
      // the package; the runtime import works under both ESM and CJS.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // @ts-ignore — subpath export, declared in package.json exports
      const vmod: any = await import('@electric-sql/pglite/vector');
      vectorExt = vmod.vector ?? vmod.default?.vector;
      if (!vectorExt || typeof vectorExt !== 'object') {
        throw new Error('pglite/vector module loaded but `vector` extension export not found');
      }
    } catch (err) {
      throw new Error(
        `Cannot initialize AgentDB pgvector extension: ${(err as Error).message}. ` +
          `Make sure @electric-sql/pglite >=0.4 is installed (it ships pgvector as a subpath export).`,
      );
    }

    try {
      const client = new PGlite(this.dataDir, {
        extensions: { vector: vectorExt },
      });
      // pglite exposes a `ready` Promise that resolves when the cluster
      // is bootable (PG_VERSION exists, base/ tables present). Await it
      // before exposing `_client`.
      await client.ready;
      this._client = client;
    } catch (err) {
      throw new Error(
        `Cannot initialize AgentDB pglite cluster at "${this.dataDir}": ` +
          `${(err as Error).message}`,
      );
    }

    // Now that the client is up, run `CREATE EXTENSION IF NOT EXISTS
    // vector` to register the extension at schema level. Idempotent — a
    // no-op when the cluster has already been initialized with vector.
    await this.enableVectorExtension();
  }

  /**
   * Server mode: import `pg`, construct a Client against connectionString,
   * call `connect()` and surface any failure as a loud throw.
   */
  private async initServer(): Promise<void> {
    if (!this.connectionString) {
      throw new Error(
        '[PostgresBackend] Server mode requires connectionString; got null. ' +
          'This is an internal invariant violation — server mode is selected only when ' +
          'connectionString is set.',
      );
    }

    let Client: new (cfg: { connectionString: string }) => PgServerClient;
    try {
      // pg is in `dependencies` but @types/pg is not installed in this
      // package (server mode is opt-in and out-of-scope for type checking
      // in Phase A/B). The runtime import succeeds when pg is installed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // @ts-ignore - pg has no type declarations available in this repo
      const pg: any = await import('pg');
      Client = pg.Client ?? pg.default?.Client;
      if (typeof Client !== 'function') {
        throw new Error('pg module loaded but Client export not found');
      }
    } catch (err) {
      throw new Error(
        `[PostgresBackend] Cannot import 'pg' for server mode (connectionString="${this.connectionString}"): ` +
          `${(err as Error).message}. Install with: npm install pg`,
      );
    }

    const client = new Client({ connectionString: this.connectionString });
    try {
      await client.connect();
      this._client = client;
    } catch (err) {
      throw new Error(
        `Cannot reach postgres at ${this.connectionString}: ${(err as Error).message}`,
      );
    }

    // ADR-0170 Phase C.1: pgvector extension required for agentdb. In
    // server mode CREATE EXTENSION requires SUPERUSER (or the user must
    // have rds_superuser on RDS, equivalent on managed services). Surface
    // a clear error on lack of privilege per `feedback-no-fallbacks`.
    await this.enableVectorExtension();
  }

  /**
   * Run `CREATE EXTENSION IF NOT EXISTS vector` once after the client
   * connects. Idempotent — `IF NOT EXISTS` makes it a no-op when the
   * extension is already registered at the schema level.
   *
   * For embedded mode, the extension binary is loaded into the WASM
   * postgres at construction time (via PGliteOptions.extensions); this
   * call just registers it in pg_extension.
   *
   * For server mode, the extension must be available on the server
   * filesystem; pg_extension registration requires SUPERUSER. We surface
   * a clear error on permission denied per ADR-0170 §"No-fallback policy".
   *
   * (ADR-0170 Phase C.1)
   */
  private async enableVectorExtension(): Promise<void> {
    if (!this._client) {
      throw new Error(
        '[PostgresBackend.enableVectorExtension] called before client construction',
      );
    }
    try {
      // pglite's exec() is multi-statement-safe; pg's Client.query handles
      // it identically. Use query() through the uniform `.query` surface.
      await this._client.query('CREATE EXTENSION IF NOT EXISTS vector');
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      // permission denied / privilege errors are loud and actionable; do
      // not auto-fallback to BYTEA. The user must either grant the
      // privilege or run an admin migration step.
      throw new Error(
        `[PostgresBackend] Cannot enable pgvector extension on the postgres cluster. ` +
          `Underlying error: ${msg}. ` +
          `In server mode the connection user must hold the privilege to ` +
          `CREATE EXTENSION vector. On managed services (RDS, Cloud SQL, ` +
          `Supabase) this typically requires the rds_superuser role or ` +
          `equivalent. On self-hosted postgres run as a superuser. ` +
          `In embedded mode this should not happen — pglite/vector is bundled ` +
          `with @electric-sql/pglite; check that the package isn't shimmed out.`,
      );
    }
  }

  /**
   * Detect a legacy SQLite database adjacent to the requested substrate
   * location. Loud-throws with the migration hint when found.
   *
   * Locations checked:
   *   - `<dataDir>/.db` (the literal file the spec names)
   *   - `<dataDir>/../memory.db` (the historical ruflo SQLite path —
   *     same dir as `.swarm/memory.pglite/`)
   */
  private assertNoLegacySqliteFile(): void {
    const candidates: string[] = [];
    if (this.dataDir) {
      candidates.push(path.join(this.dataDir, '.db'));
      const parent = path.dirname(this.dataDir);
      candidates.push(path.join(parent, 'memory.db'));
    }
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          // Verify SQLite signature so a non-sqlite `.db` file (unusual
          // but possible) doesn't trip the gate.
          const fd = fs.openSync(candidate, 'r');
          try {
            const buf = Buffer.alloc(16);
            fs.readSync(fd, buf, 0, 16, 0);
            if (buf.toString('utf8').startsWith('SQLite format 3')) {
              throw new Error(
                `Legacy SQLite database detected at "${candidate}". ` +
                  `Run 'agentdb migrate --from sqlite --to pglite' to convert. ` +
                  `No auto-migration. (ADR-0170 Phase D)`,
              );
            }
          } finally {
            fs.closeSync(fd);
          }
        }
      } catch (err) {
        // Re-throw our own loud error; swallow IO errors (file appeared
        // and vanished, permissions, etc.) — those are recoverable.
        if ((err as Error).message?.startsWith('Legacy SQLite database detected')) {
          throw err;
        }
      }
    }
  }

  /**
   * Query the underlying client. Controllers consume this directly.
   * Returns the postgres-style `{ rows }` result shape uniformly across
   * embedded and server modes.
   */
  async query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
    if (!this.initialized || !this._client) {
      throw new Error('[PostgresBackend] query() called before initialize()');
    }
    return this._client.query(sql, params);
  }

  /**
   * Execute a multi-statement script (DDL). Embedded uses `exec()`;
   * server falls back to `query()` since pg.Client.query accepts
   * multi-statement strings.
   */
  async exec(sql: string): Promise<void> {
    if (!this.initialized || !this._client) {
      throw new Error('[PostgresBackend] exec() called before initialize()');
    }
    if (this.mode === 'embedded') {
      await (this._client as PgliteClient).exec(sql);
    } else {
      // pg.Client.query handles multi-statement strings when params is undefined.
      await this._client.query(sql);
    }
  }

  /** Returns the underlying client. Phase A consumers go through query()/exec(). */
  get client(): PgliteClient | PgServerClient {
    if (!this._client) {
      throw new Error('[PostgresBackend] client accessed before initialize()');
    }
    return this._client;
  }

  /** Embedded mode dataDir (null in server mode). Useful for harness assertions. */
  get embeddedDataDir(): string | null {
    return this.mode === 'embedded' ? this.dataDir : null;
  }

  /** Connection mode (for diagnostics). */
  get connectionMode(): 'embedded' | 'server' {
    return this.mode;
  }

  // ==========================================================================
  // VectorBackend interface — Phase A stubs
  // ==========================================================================
  // The vector-ops surface is owned by Phase C (pgvector integration). In
  // Phase A, controllers route their vector writes through their existing
  // VectorBackend (RuVector/HNSWLib/etc.) and their SQL ops through this
  // backend's `query()`. The methods below are stubs that loud-throw if
  // someone wires PostgresBackend as a vector index by mistake.

  insert(_id: string, _embedding: Float32Array, _metadata?: Record<string, unknown>): void {
    throw new Error(
      '[PostgresBackend] VectorBackend.insert() is not implemented in Phase A. ' +
        'Vector ops integrate with pgvector in Phase C; for SQL ops use this.query(...). ' +
        'See ADR-0170 §Phase plan.',
    );
  }

  insertBatch(
    _items: Array<{ id: string; embedding: Float32Array; metadata?: Record<string, unknown> }>,
  ): void {
    throw new Error(
      '[PostgresBackend] VectorBackend.insertBatch() is not implemented in Phase A. ' +
        'See ADR-0170 §Phase plan.',
    );
  }

  search(_query: Float32Array, _k: number, _options?: SearchOptions): SearchResult[] {
    throw new Error(
      '[PostgresBackend] VectorBackend.search() is not implemented in Phase A. ' +
        'See ADR-0170 §Phase plan.',
    );
  }

  remove(_id: string): boolean {
    throw new Error(
      '[PostgresBackend] VectorBackend.remove() is not implemented in Phase A. ' +
        'See ADR-0170 §Phase plan.',
    );
  }

  getStats(): VectorStats {
    return {
      count: 0,
      dimension: this.config.dimension ?? this.config.dimensions ?? 0,
      metric: this.config.metric,
      backend: 'rvf',
      memoryUsage: 0,
    };
  }

  async save(_path: string): Promise<void> {
    // pglite/pg both persist on their own; save() is a no-op.
  }

  async load(_path: string): Promise<void> {
    // pglite/pg both restore on their own; load() is a no-op.
  }

  close(): void {
    if (!this._client) return;
    try {
      if (this.mode === 'embedded') {
        // pglite close() is async; fire-and-forget since VectorBackend.close()
        // is sync by interface contract.
        const closePromise = (this._client as PgliteClient).close();
        if (closePromise && typeof closePromise.then === 'function') {
          closePromise.catch(() => {
            /* swallow — best-effort shutdown */
          });
        }
      } else {
        const endPromise = (this._client as PgServerClient).end();
        if (endPromise && typeof endPromise.then === 'function') {
          endPromise.catch(() => {
            /* swallow — best-effort shutdown */
          });
        }
      }
    } catch {
      // swallow — best-effort shutdown
    }
    this._client = null;
    this.initialized = false;
  }
}
