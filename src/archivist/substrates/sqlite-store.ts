// charter: substrate-seam
//
// ADR-0180 Open Follow-up #10 — `makeSqliteSubstrate` primitive.
//
// The SQLite sibling of `makeFsJsonSubstrate`. Where the FS-JSON substrate has
// to hand-build a durability stack (O_EXCL sentinel + tmp + fsync + rename),
// SQLite already provides atomicity, isolation, and WAL durability in-process
// via `db.transaction(fn)`, and SQLite's own file lock serializes writers
// cross-process. This factory is therefore a thin pass-through: it wraps the
// handler body in a `better-sqlite3` transaction and exposes the live `db`
// handle so handlers can run prepared statements.
//
// CRITICAL — no O_EXCL sentinel above `db.transaction` (ADR-0180 disposition
// #10, lines 468 / 519). Forcing a JS-side exclusive lock above SQLite's own
// lock deadlocks the moment two SQLite-backed stores compose: each acquires
// its own sentinel, then blocks waiting on the other. SQLite's BEGIN IMMEDIATE
// file lock is the only exclusion this substrate uses.
//
// Async/sync bridge: `better-sqlite3` transactions are SYNCHRONOUS — the body
// passed to `db.transaction(...)` must not await. The archivist's substrate
// seam (`SubstrateAccess.withWrite`) is async, so the inner handler `fn` is a
// `Promise`-returning function. We run `fn` to obtain its promise, await it
// OUTSIDE the synchronous txn body is NOT possible (the txn would commit
// before the promise settles). Instead the SQLite substrate contract requires
// handler bodies to be synchronous in substance: `fn` may be `async` in
// signature, but its work against `handle.db` runs synchronously inside the
// transaction. We invoke `fn` inside `db.transaction`, capture the returned
// promise, and — because better-sqlite3 statement calls are synchronous — the
// promise is already settled by the time `db.transaction()()` returns. We then
// resolve `withWrite`'s outer promise from the captured value.

import type BetterSqlite3 from 'better-sqlite3';

import { makeSubstrateAccess } from '../substrate-internal.js';
import type {
  BulkIntent,
  ReadCapableSubstrate,
  StoreId,
  SubstrateAccess,
  SubstrateHandle,
} from '../types.js';

// ── Handle augmentation ──────────────────────────────────────────────────────
//
// The base `SubstrateHandle` is substrate-agnostic. The SQLite substrate
// additionally exposes the live `db` so handlers can prepare and run
// statements inside the transaction. Handlers that target SQLite narrow the
// handle to `SqliteSubstrateHandle` to reach `.db`.

export interface SqliteSubstrateHandle extends SubstrateHandle {
  /** The live `better-sqlite3` database, valid only inside `withWrite`/`withBulkWrite`. */
  readonly db: BetterSqlite3.Database;
}

// ── Read-only `query` predicate shape ────────────────────────────────────────
//
// `ReadOnlySubstrateHandle.query` types `scope.predicate` as `unknown`. The
// SQLite substrate is SQL-addressed (not whole-document, not key/value), so its
// predicate is a parameterized statement: `{ sql, params? }`. `db.prepare(sql)
// .all(params)` is the read primitive — the read-only seam never opens a
// transaction (reads carry no audit ceremony per ADR-0180 §Audit chain), so
// `query` runs the prepared `SELECT` directly on the shared handle.
//
// Fail-loud (`feedback-no-fallbacks`): a predicate that is not `{ sql: string }`
// throws — a mistyped predicate must not silently return an empty set.

/** Parameterized SQL predicate for `SqliteSubstrate.query`. */
export interface SqliteQueryPredicate {
  /** A `SELECT` statement. Parameter placeholders bind from `params`. */
  readonly sql: string;
  /** Positional / named bind parameters for the prepared statement. */
  readonly params?: ReadonlyArray<unknown> | Record<string, unknown>;
}

/** Narrow an `unknown` predicate to `SqliteQueryPredicate`, throwing on mismatch. */
function asSqliteQueryPredicate(predicate: unknown, storeId: StoreId): SqliteQueryPredicate {
  if (
    predicate === null ||
    typeof predicate !== 'object' ||
    typeof (predicate as { sql?: unknown }).sql !== 'string'
  ) {
    throw new Error(
      `makeSqliteSubstrate: query predicate for store '${storeId as string}' must be ` +
        `{ sql: string; params?: unknown[] | Record<string, unknown> } — SQLite is SQL-addressed`,
    );
  }
  return predicate as SqliteQueryPredicate;
}

// ── Public factory ───────────────────────────────────────────────────────────

/**
 * Build a SQLite `SubstrateAccess` over an open `better-sqlite3` database.
 *
 * `withWrite(fn)` wraps `fn` in `db.transaction(...)` — BEGIN IMMEDIATE on
 * entry, COMMIT on normal return, ROLLBACK if `fn` throws. SQLite's own file
 * lock provides cross-process serialization; there is deliberately no JS-side
 * sentinel lock above the transaction (see module header — it deadlocks under
 * composition).
 *
 * `withBulkWrite(intent, fn)` delegates to `withWrite`. A SQLite transaction is
 * already the right granularity for a bulk apply (1000 rows commit atomically
 * in one txn); the archivist emits the one-per-bulk audit manifest a layer up,
 * so the substrate only owns the transaction boundary.
 *
 * The `SubstrateHandle` delivered to `fn` is a `SqliteSubstrateHandle` exposing
 * `.db`; handlers run prepared statements against it synchronously. The base
 * `read`/`write` methods are intentionally minimal stubs — SQLite handlers
 * address rows via SQL on `handle.db`, not via the key/value `read`/`write`
 * shape that the FS-JSON whole-document substrate uses.
 *
 * The returned handle also carries the read-only `query` / `vectorSearch`
 * surface (`ReadCapableSubstrate`) consumed by the read-dispatch router:
 *   - `query({ storeId, predicate })` runs `predicate.sql` (a parameterized
 *     `SELECT`) via `db.prepare(...).all(params)` — no transaction, since reads
 *     carry no audit ceremony.
 *   - `vectorSearch(...)` throws: the 5 PERMANENT_SQLITE_CARVE_OUT controllers
 *     (ADR-0166) are relational aggregation reads, not vector stores — a vector
 *     query routed here is a misroute.
 *
 * @example
 *   const substrate = makeSqliteSubstrate(db);
 *   await substrate.withWrite({ storeId }, async (h) => {
 *     const handle = h as SqliteSubstrateHandle;
 *     handle.db.prepare('INSERT INTO patterns (id, payload) VALUES (?, ?)')
 *       .run(id, JSON.stringify(payload));
 *   });
 */
export function makeSqliteSubstrate(db: BetterSqlite3.Database): SubstrateAccess {
  const handle: SqliteSubstrateHandle & ReadCapableSubstrate = {
    db,

    // SQLite handlers address rows via SQL on `handle.db`. The key/value
    // `read`/`write` surface exists only to satisfy `SubstrateHandle`; it is
    // not the SQLite addressing model and substrate-specific handlers do not
    // call it. Throwing (rather than silently returning) keeps a mistaken
    // key/value call from masquerading as a successful no-op — per
    // `feedback-no-fallbacks`.
    async read<R>(_scope: { storeId: StoreId; key: string }): Promise<R | undefined> {
      throw new Error(
        'makeSqliteSubstrate: handlers must query via handle.db (SQL), not the key/value read() surface',
      );
    },

    async write<T>(_scope: { storeId: StoreId; key: string; payload: T }): Promise<void> {
      throw new Error(
        'makeSqliteSubstrate: handlers must mutate via handle.db (SQL), not the key/value write() surface',
      );
    },

    async withWrite<T>(
      scope: { storeId: StoreId },
      fn: (h: SubstrateHandle) => Promise<T>,
    ): Promise<T> {
      void scope.storeId;

      // `better-sqlite3` transactions are synchronous: the wrapped body runs to
      // completion (BEGIN IMMEDIATE → body → COMMIT) before `txn()` returns,
      // and ROLLBACKs if the body throws. We invoke `fn` inside the body and
      // capture its promise; because every `handle.db` statement call is
      // synchronous, that promise is already settled when `txn()` returns.
      let captured: Promise<T>;
      const txn = db.transaction(() => {
        captured = fn(handle);
      });
      txn();

      // `captured` is definitely assigned — `txn()` runs the body synchronously
      // above. Awaiting resolves the value (or re-throws an async rejection;
      // a synchronous throw inside `fn` already triggered ROLLBACK via `txn()`).
      return await captured!;
    },

    async withBulkWrite(
      intent: BulkIntent,
      fn: (h: SubstrateHandle) => Promise<void>,
    ): Promise<void> {
      // A SQLite transaction is already atomic for an N-row apply — bulk
      // collapses to a single `withWrite`. The archivist owns the bulk-manifest
      // audit emission; this substrate only owns the transaction boundary.
      void intent;
      await this.withWrite({ storeId: intent.tableName as StoreId }, fn);
    },

    // ── Read-only surface (ReadCapableSubstrate) ─────────────────────────────

    async query<R>(scope: { storeId: StoreId; predicate: unknown }): Promise<ReadonlyArray<R>> {
      // Real SQL through the shared handle. Reads carry no audit ceremony
      // (ADR-0180 §Audit chain) so this runs the prepared `SELECT` directly —
      // no `db.transaction` wrapper. `better-sqlite3` `.all()` is synchronous;
      // the `async` signature satisfies `ReadOnlySubstrateHandle`.
      const { sql, params } = asSqliteQueryPredicate(scope.predicate, scope.storeId);
      const stmt = db.prepare(sql);
      const rows = params === undefined ? stmt.all() : stmt.all(params as never);
      return rows as ReadonlyArray<R>;
    },

    async vectorSearch<R>(scope: {
      storeId: StoreId;
      vector: Float32Array;
      topK: number;
    }): Promise<ReadonlyArray<{ item: R; score: number }>> {
      // Throw-by-design: the SQLite carve-out is the 5 PERMANENT_SQLITE_CARVE_OUT
      // *controllers* (ADR-0166) — CausalMemoryGraph, CausalRecall,
      // NightlyLearner, LearningSystem aggregations, ReasoningBank GROUP-BY.
      // These are relational aggregation reads, not vector indexes. A
      // `vectorSearch` routed to a SQLite-family storeId is a routing bug — the
      // store should classify to the RVF family. Fail loud rather than
      // silent-empty (`feedback-no-fallbacks`).
      void scope.vector;
      void scope.topK;
      throw new Error(
        `makeSqliteSubstrate: vectorSearch is not available — store '${scope.storeId as string}' ` +
          `resolves to the SQLite carve-out (ADR-0166: relational aggregation reads, no vector index). ` +
          `A vector query must route to an RVF-family store.`,
      );
    },

    // ADR-0181 task #99 commit 1 — `(namespace, key)` lookup is NOT a SQLite
    // operation at this seam. The SQLite carve-out stores are SQL-addressed
    // aggregations (episodes ⨝ episode_embeddings, skills ⨝ skill_embeddings,
    // hierarchical_memory) whose lookup model is per-table-specific SQL, not a
    // shared `(namespace, key)` schema. A `getByKey` call routed here is the
    // same class of misroute as a key/value `read` — fail loud rather than
    // silently no-op (`feedback-no-fallbacks`). Mirrors the `read`/`write` stub
    // pattern above.
    async getByKey<R>(_scope: {
      storeId: StoreId;
      namespace: string;
      key: string;
    }): Promise<R | undefined> {
      throw new Error(
        'makeSqliteSubstrate: getByKey is not supported — the SQLite carve-out is SQL-addressed ' +
          '(no shared (namespace, key) schema). Use `query({ sql, params })` against `handle.db` directly.',
      );
    },

    // ADR-0181 task #99 commit 1 — paginated list is likewise NOT a SQLite
    // operation at this seam (same reasoning as `getByKey`). The carve-out
    // tables don't share a uniform pagination shape; callers must run their
    // own `LIMIT ? OFFSET ?` SQL via `query`.
    async list<R>(_scope: {
      storeId: StoreId;
      namespace?: string;
      limit?: number;
      offset?: number;
    }): Promise<ReadonlyArray<R>> {
      throw new Error(
        'makeSqliteSubstrate: list is not supported — the SQLite carve-out is SQL-addressed ' +
          '(no shared pagination shape). Use `query({ sql, params })` against `handle.db` directly.',
      );
    },
  };

  return makeSubstrateAccess(handle);
}
