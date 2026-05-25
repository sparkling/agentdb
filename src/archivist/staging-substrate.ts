// charter: mutation-invariants
//
// ADR-0246 F-03-002: staged-write proxy that DEFERS substrate commits until
// AFTER the handler returns AND invariants have been evaluated.
//
// Pre-fix flow (`index.ts` `dispatchMutationInternal`, post-ADR-0180):
//   1. Run handler (which calls `ctx.substrate.withWrite(...)` — the substrate
//      `saveJsonAtomic`s INSIDE the handler closure, committing to disk).
//   2. Evaluate invariants. (`substrateStateBefore` / `After` are `undefined`).
//   3. On violation, write `state: 'rejected'` to audit, then throw.
//   4. Substrate is NOT rolled back — the rejected entry now lies on disk.
//
// Charter-required flow (`MODULE.md:45`): "invariants evaluated AT WRITE-TIME
// BEFORE the audit entry transitions to `applied`; violation ABORTS the WRITE
// and records `state: 'rejected', reason: 'invariant_violation'`."
//
// ── Path (a) — FS-JSON (Batch 1, post concurrent-write fix) ──────────────────
//
// FS-JSON: handler's `read()` and `write()` calls go through the in-memory
// staged map for ordering / cross-key consistency within the handler. BUT:
// `withWrite` takes the real substrate's file lock for the duration of
// `fn(handle)` AND commits any FS-JSON entries the handler wrote BEFORE the
// lock releases. This closes a concurrent-write data-loss window where two
// CLI processes would both read pre-state outside any lock, both stage their
// mutations, and the second `commit()` would overwrite the first's bytes.
//
// Trade-off: invariants-on-staged-state is LOST for FS-JSON only. Invariants
// still run (and a violation will still trigger `rollback()`), but for
// FS-JSON the bytes are already on disk by the time invariants are evaluated —
// rollback cannot unwind them. RVF + SQLite preserve the staged-state
// guarantee (see Path (b) below). The 100% durability bar of ADR-0123 takes
// precedence over the deferred-invariants property of ADR-0246 for FS-JSON,
// which is whole-document atomic anyway — the only invariant that could
// reasonably reject the write would be one that inspects the staged document
// itself, and a violation there is rare versus the routine concurrent-write
// pattern (multi-process `hive-mind_memory set`).
//
// ── Path (b) — RVF + SQLite (this commit, ADR-0246 named follow-up) ──────────
//
// **RVF staging**: the substrate's `withWrite` hands the handler a
// `RvfSubstrateHandle` whose `.rvf` is a *recording proxy* — every
// `insertAsync` / `insertBatchAsync` / `removeAsync` call is journaled in
// memory. `commit()` replays the journal through the real RVF backend. On
// invariant violation, `commit()` is not called and the journal is dropped —
// nothing reaches the .rvf file. The Rust crate's atomicity + fsync still
// applies on commit (each `insertAsync` invocation routes through
// `db.ingestBatch` as today).
//
// **SQLite staging**: the substrate's `withWrite` opens a SAVEPOINT around
// the handler. On `commit()`, RELEASE the savepoint (the surrounding
// transaction-or-no-transaction state is preserved). On rollback (no
// commit), ROLLBACK TO + RELEASE the savepoint — every INSERT/UPDATE the
// handler ran (including those routed through capability writers that share
// the same `better-sqlite3` handle per ADR-0166) is undone. The 5
// PERMANENT_SQLITE_CARVE_OUT controllers all share one handle per ADR-0166,
// so the SAVEPOINT covers every write that happened during the dispatch.
//
// After the handler returns:
//   - `getStagedFsJsonState({storeId, key})` returns the staged "after" value
//     (FS-JSON only).
//   - `getInitialFsJsonState({storeId, key})` returns the pre-handler "before"
//     value (FS-JSON only — RVF/SQLite stage the transactional side-effects,
//     not whole-state snapshots).
//   - `commit()` replays the staged writes through the real substrates:
//     FS-JSON is a NO-OP for entries already committed in-lock during
//     `withWrite` (concurrent-write fix); RVF replays the insert/remove
//     journal, SQLite RELEASEs the savepoint. On pre-commit invariant
//     violation, `rollback()` is called: FS-JSON entries are NOT rolled
//     back (already on disk — see Path (a) trade-off above), RVF discards
//     the journal, SQLite ROLLBACKs TO + RELEASEs the savepoint.

import type BetterSqlite3 from 'better-sqlite3';
import type { ReadCapableSubstrate, StoreId, SubstrateAccess, SubstrateHandle, BulkIntent } from './types.js';
import { classifyStore } from './substrate-registry.js';
import { makeSubstrateAccess } from './substrate-internal.js';
import type { RvfSubstrateHandle } from './substrates/rvf-store.js';
import type { SqliteSubstrateHandle } from './substrates/sqlite-store.js';

/**
 * One staged write entry — a (storeId, key) pair with its before/after payload.
 * `before` is loaded lazily on first touch (read or write) and frozen for the
 * duration of the staging session; `after` is updated by every subsequent
 * `write({storeId, key, payload})` call inside the handler.
 */
interface StagedEntry {
  readonly storeId: StoreId;
  readonly key: string;
  before: unknown;
  after: unknown;
  // Whether `before` was loaded (the substrate was read at least once) — used
  // to disambiguate "field absent" from "never touched".
  beforeLoaded: boolean;
  // Whether `after` was written (the handler called `write` for this scope) —
  // distinct from `before` to support read-only handler paths.
  written: boolean;
  // FS-JSON carve-out (concurrent-write data-loss regression fix —
  // ADR-0246 / ADR-0123): FS-JSON entries are committed in-lock during
  // `withWrite` (the only way to prevent lost updates from concurrent
  // CLI processes reading pre-state outside any lock). Once committed
  // here, the later `commit()` step is a no-op for the entry. RVF + SQLite
  // entries always have `committed=false` and go through the deferred
  // `commit()` path that preserves the invariants-on-staged-state contract.
  committed: boolean;
}

/**
 * One journaled RVF write — either `insertAsync(id, embedding, metadata)` or
 * `removeAsync(id)`. Replayed in declaration order on commit.
 */
type RvfJournalEntry =
  | { readonly op: 'insertAsync'; readonly id: string; readonly embedding: Float32Array; readonly metadata?: Record<string, unknown> }
  | { readonly op: 'insertBatchAsync'; readonly items: ReadonlyArray<{ readonly id: string; readonly embedding: Float32Array; readonly metadata?: Record<string, unknown> }> }
  | { readonly op: 'removeAsync'; readonly id: string };

/**
 * One active SQLite SAVEPOINT for the dispatch. Tracked per storeId so the
 * commit/rollback path can RELEASE / ROLLBACK TO the savepoint by name.
 */
interface SqliteSavepoint {
  readonly storeId: StoreId;
  readonly name: string;
  /** The shared `better-sqlite3` handle — reused for RELEASE / ROLLBACK TO. */
  readonly db: BetterSqlite3.Database;
}

export interface StagingSubstrate {
  /** The branded `SubstrateAccess` to thread onto the handler's context. */
  readonly access: SubstrateAccess;
  /**
   * After the handler returns AND invariants pass, replay every staged write
   * through the real substrate (FS-JSON saves the document, RVF replays
   * insert/remove journal, SQLite RELEASEs its SAVEPOINT).
   */
  commit(): Promise<void>;
  /**
   * After the handler returns AND invariants violate, discard every staged
   * write (FS-JSON drops staged entries — never written to disk, RVF drops
   * the journal, SQLite ROLLBACKs TO + RELEASEs its SAVEPOINT).
   */
  rollback(): Promise<void>;
  /** The first (and only) entry for a (storeId, key) — `undefined` if never touched. */
  getStaged(storeId: StoreId, key: string): StagedEntry | undefined;
  /** All staged entries (for invariant evaluation across multiple storeIds). */
  getAllStaged(): ReadonlyArray<StagedEntry>;
  /** True if any staged FS-JSON write would have committed. */
  hasStagedWrites(): boolean;
}

/**
 * Counter for SAVEPOINT and RVF-journal proxy uniqueness within a single
 * dispatch. Module-local because each staging substrate is a fresh instance
 * per dispatch; collisions between dispatches are impossible.
 */
let savepointCounter = 0;

function nextSavepointName(storeId: StoreId): string {
  // SAVEPOINT names must be SQL identifiers. Use a deterministic prefix +
  // monotonic counter to keep them readable in any error log.
  const safe = (storeId as string).replace(/[^a-zA-Z0-9_]/g, '_');
  return `staging_${safe}_${++savepointCounter}`;
}

/**
 * Build a staging substrate that wraps the archivist's routing substrate.
 *
 * `resolveSubstrate(storeId)` returns the real `SubstrateAccess` for a given
 * storeId — the archivist's `routingSubstrate()` factory minus the handle
 * unwrapping. The staging proxy uses it for both initial loads (`read`,
 * `withWrite.read`) and the final `commit()` / `rollback()` replay.
 */
export function makeStagingSubstrate(
  resolveSubstrate: (storeId: StoreId) => SubstrateAccess,
): StagingSubstrate {
  // (storeId|key) → StagedEntry. Map by composite string to avoid the brand
  // collision of using StoreId+key as a tuple key.
  const staged = new Map<string, StagedEntry>();

  // RVF journal: per-storeId list of write ops captured during the dispatch.
  // Per-storeId so two different RVF stores can't accidentally interleave
  // (today every RVF storeId routes to the same backend, but the per-storeId
  // shape is forward-compatible with future multi-backend setups).
  const rvfJournal = new Map<string, RvfJournalEntry[]>();

  // SQLite savepoints: per-storeId list of active savepoints. The dispatch
  // path opens a savepoint on first `withWrite` per storeId and tracks it
  // here; commit/rollback iterates this list.
  const sqliteSavepoints: SqliteSavepoint[] = [];

  function stagingKey(storeId: StoreId, key: string): string {
    return `${storeId as string}::${key}`;
  }

  /**
   * Get or create the staged entry for a (storeId, key) pair. On first touch
   * (read OR write), load the current value from disk into `before`.
   */
  async function ensureEntry(storeId: StoreId, key: string): Promise<StagedEntry> {
    const k = stagingKey(storeId, key);
    let entry = staged.get(k);
    if (!entry) {
      // Lazy-load `before` from the real substrate. For FS-JSON whole-document
      // stores, `key: 'root'` returns the whole document; the staging layer
      // accumulates updates to that document in `after`.
      const substrate = resolveSubstrate(storeId);
      const before = await (substrate as unknown as ReadCapableSubstrate).read({ storeId, key });
      entry = {
        storeId,
        key,
        before,
        after: before,
        beforeLoaded: true,
        written: false,
        committed: false,
      };
      staged.set(k, entry);
    }
    return entry;
  }

  function family(storeId: StoreId): 'fs-json' | 'rvf' | 'sqlite' {
    return classifyStore(storeId);
  }

  /**
   * Build a recording RVF handle proxy. `handle.rvf.insertAsync(...)` and
   * `handle.rvf.removeAsync(...)` calls are journaled per-storeId; reads
   * (`searchAsync`, etc.) pass through to the real backend so the handler can
   * still observe pre-dispatch state. `insertBatchAsync` is journaled as one
   * batch entry — replayed verbatim through the real backend on commit.
   */
  function makeRvfRecordingHandle(storeId: StoreId, realHandle: RvfSubstrateHandle): RvfSubstrateHandle {
    const journal = rvfJournal.get(storeId as string) ?? [];
    rvfJournal.set(storeId as string, journal);
    const rvfProxy = new Proxy(realHandle.rvf, {
      get(target, prop, receiver) {
        if (prop === 'insertAsync') {
          return async (id: string, embedding: Float32Array, metadata?: Record<string, unknown>): Promise<void> => {
            journal.push({ op: 'insertAsync', id, embedding, metadata });
          };
        }
        if (prop === 'insertBatchAsync') {
          return async (items: Array<{ id: string; embedding: Float32Array; metadata?: Record<string, unknown> }>): Promise<void> => {
            journal.push({ op: 'insertBatchAsync', items });
          };
        }
        if (prop === 'removeAsync') {
          return async (id: string): Promise<boolean> => {
            journal.push({ op: 'removeAsync', id });
            // The handler usually doesn't care about the return value during
            // staging; we report `true` to keep the handler's code path
            // identical to the committed shape. The real `removeAsync`'s
            // return value will be honored at commit-time replay.
            return true;
          };
        }
        // All other methods (searchAsync, getStatsAsync, etc.) pass through.
        return Reflect.get(target, prop, receiver);
      },
    });
    // Return a handle whose `.rvf` is the recording proxy. Other handle
    // properties (read/write/withWrite/withBulkWrite) come from the real
    // handle but are wrapped to keep recursive `withWrite` calls staging too.
    const recordingHandle: RvfSubstrateHandle = {
      ...realHandle,
      rvf: rvfProxy,
      // Inner `withWrite` calls (rare for RVF handlers, but possible) keep
      // staging: the inner fn receives the same recording handle.
      withWrite: async <T>(scope: { storeId: StoreId }, fn: (h: SubstrateHandle) => Promise<T>): Promise<T> => {
        return fn(recordingHandle);
      },
    };
    return recordingHandle;
  }

  /**
   * Build a SQLite handle with an outer SAVEPOINT. Opens the savepoint
   * immediately so the handler's writes (whether through `handle.db.prepare`
   * or through capability writers that share the same `better-sqlite3`
   * handle) land inside it. The savepoint is tracked for later
   * commit/rollback.
   *
   * SAVEPOINT scope: in SQLite, a savepoint can stand on its own — without
   * an enclosing `BEGIN`, the savepoint IS the transaction. Statements
   * issued after the savepoint and before its `RELEASE` are part of the
   * transaction; `ROLLBACK TO SAVEPOINT` undoes them all. We deliberately
   * do NOT call `makeSqliteSubstrate.withWrite` (which would open a nested
   * `db.transaction(fn)` = `BEGIN IMMEDIATE → fn → COMMIT` — the inner
   * COMMIT would commit our SAVEPOINT before the dispatch path's
   * invariants could decide on commit/rollback). Instead we use the
   * substrate's `.db` directly with an outer SAVEPOINT only.
   */
  function makeSqliteStagingHandle(storeId: StoreId, db: BetterSqlite3.Database): SqliteSubstrateHandle {
    const name = nextSavepointName(storeId);
    // SAVEPOINT opens immediately so EVERY write during the dispatch — direct
    // via `handle.db.prepare(...).run()` or indirect via capability writers
    // sharing the same `better-sqlite3` handle — lands inside it.
    db.prepare(`SAVEPOINT ${name}`).run();
    sqliteSavepoints.push({ storeId, name, db });
    // Return a handle whose `.db` is the same database. `withWrite` is the
    // identity wrapper — the outer SAVEPOINT already provides isolation, no
    // nested `db.transaction(fn)` is needed (and would in fact commit-
    // through our SAVEPOINT before the dispatch path's invariants run).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stagingHandle: SqliteSubstrateHandle = {
      db,
      async read() {
        throw new Error(
          'makeSqliteSubstrate(staging): handlers must query via handle.db (SQL), not the key/value read() surface',
        );
      },
      async write() {
        throw new Error(
          'makeSqliteSubstrate(staging): handlers must mutate via handle.db (SQL), not the key/value write() surface',
        );
      },
      async withWrite<T>(_scope: { storeId: StoreId }, fn: (h: SubstrateHandle) => Promise<T>): Promise<T> {
        // No nested transaction — outer SAVEPOINT covers it.
        return fn(stagingHandle);
      },
      async withBulkWrite(_intent: BulkIntent, fn: (h: SubstrateHandle) => Promise<void>): Promise<void> {
        await fn(stagingHandle);
      },
    };
    return stagingHandle;
  }

  /**
   * Build a SubstrateHandle that:
   *   - For FS-JSON: read returns staged `after`; write updates `after`;
   *     withWrite invokes fn with the SAME handle (writes stay staged).
   *   - For RVF: read passes through; withWrite hands the handler a recording
   *     RvfSubstrateHandle whose `.rvf` journals every insert/remove call.
   *   - For SQLite: read passes through; withWrite opens an outer SAVEPOINT
   *     and hands the handler a handle whose `.db` is the shared database
   *     (writes via `handle.db` or via capability writers sharing the same
   *     handle land inside the savepoint).
   */
  const handle: SubstrateHandle = {
    async read<R>(scope: { storeId: StoreId; key: string }): Promise<R | undefined> {
      if (family(scope.storeId) === 'fs-json') {
        const entry = await ensureEntry(scope.storeId, scope.key);
        return entry.after as R | undefined;
      }
      return (resolveSubstrate(scope.storeId) as unknown as ReadCapableSubstrate).read(scope) as Promise<R | undefined>;
    },

    async write<T>(scope: { storeId: StoreId; key: string; payload: T }): Promise<void> {
      if (family(scope.storeId) === 'fs-json') {
        const entry = await ensureEntry(scope.storeId, scope.key);
        entry.after = scope.payload;
        entry.written = true;
        return;
      }
      // RVF / SQLite top-level write: pass through. Handlers that need staging
      // for these substrates use `withWrite` (which is what every RVF/SQLite
      // handler in the corpus does today — the `handle.write` key/value
      // surface throws on RVF/SQLite per fail-loud design).
      await (resolveSubstrate(scope.storeId) as unknown as SubstrateHandle).write(scope);
    },

    async withWrite<T>(
      scope: { storeId: StoreId },
      fn: (h: SubstrateHandle) => Promise<T>,
    ): Promise<T> {
      const fam = family(scope.storeId);
      if (fam === 'fs-json') {
        // FS-JSON carve-out (concurrent-write data-loss regression fix —
        // ADR-0246 / ADR-0123 100% durability bar). Earlier this branch
        // simply returned `fn(handle)` with no lock held — that caused
        // lost updates under concurrent CLI processes: handler reads
        // pre-state outside any lock, mutates an in-memory snapshot, and
        // the deferred `commit()` writes the whole document over a
        // concurrent commit. (Repro: `adr0123-conc-write`, `adr0104-mem-distinct`.)
        //
        // The carve-out: take the REAL substrate's `withWrite` lock for
        // the duration of `fn(handle)` so the handler's read + mutate
        // both happen inside the file lock. After `fn` returns (still
        // inside the lock), replay any FS-JSON entries this scope wrote
        // through the inner real handle's `write()` — landing the
        // committed bytes atomically before the lock releases — and mark
        // those entries `committed=true` so the dispatch path's later
        // `commit()` skips them.
        //
        // Trade-off (documented in MODULE.md:45 and dispatch comments):
        // FS-JSON loses "invariants on staged state". Invariants still run
        // for FS-JSON entries but they are evaluated against ALREADY-
        // COMMITTED bytes. RVF + SQLite paths are unaffected — they still
        // get the deferred-commit + invariants-on-staged-state guarantee
        // via their journal / SAVEPOINT machinery below.
        const realSubstrate = resolveSubstrate(scope.storeId) as unknown as SubstrateHandle;
        return realSubstrate.withWrite(scope, async (realHandle) => {
          const result = await fn(handle);
          // Replay this scope's FS-JSON writes inside the same lock. Only
          // entries for THIS storeId are committed here — `realHandle` is
          // bound to one FS-JSON path (substrate ignores `scope.storeId`
          // and writes to its factory-bound path), so committing a
          // different storeId's entry through it would write the wrong
          // file. Cross-store FS-JSON writes within one `withWrite` are
          // not a pattern in the corpus (every handler uses one storeId
          // per `withWrite`); any other-storeId entries fall through to
          // the deferred `commit()` path. Entries already committed by a
          // prior nested `withWrite` are skipped.
          for (const entry of staged.values()) {
            if (entry.committed || !entry.written) continue;
            if (family(entry.storeId) !== 'fs-json') continue;
            if (entry.storeId !== scope.storeId) continue;
            await realHandle.write({ storeId: entry.storeId, key: entry.key, payload: entry.after });
            entry.committed = true;
          }
          return result;
        });
      }
      if (fam === 'rvf') {
        // Open the real substrate's `withWrite` to get the real RvfSubstrateHandle,
        // then wrap it in a recording proxy that journals all writes.
        const realSubstrate = resolveSubstrate(scope.storeId) as unknown as SubstrateHandle;
        return realSubstrate.withWrite(scope, async (realHandle) => {
          const recordingHandle = makeRvfRecordingHandle(scope.storeId, realHandle as RvfSubstrateHandle);
          return fn(recordingHandle);
        });
      }
      // sqlite: DO NOT call `realSubstrate.withWrite` — that opens
      // `db.transaction(fn)` = `BEGIN IMMEDIATE → fn → COMMIT`, which would
      // commit our SAVEPOINT before the dispatch path's invariants run. We
      // extract the underlying `.db` directly from the substrate handle and
      // open the SAVEPOINT outside any enclosing transaction.
      const realSubstrate = resolveSubstrate(scope.storeId);
      const sqliteHandle = realSubstrate as unknown as SqliteSubstrateHandle;
      const stagingHandle = makeSqliteStagingHandle(scope.storeId, sqliteHandle.db);
      return fn(stagingHandle);
    },

    async withBulkWrite(intent: BulkIntent, fn: (h: SubstrateHandle) => Promise<void>): Promise<void> {
      // Bulk writes follow the same family-routing as withWrite — fs-json
      // collapses to whole-document staged writes; rvf/sqlite use the same
      // recording-proxy / SAVEPOINT pattern as withWrite.
      const storeId = intent.tableName as StoreId;
      const fam = family(storeId);
      if (fam === 'fs-json') {
        // FS-JSON carve-out (see `withWrite` above for full rationale):
        // hold the real substrate's file lock for the handler's duration
        // and commit any FS-JSON writes inside that lock to prevent
        // lost-update races between concurrent CLI processes.
        const realSubstrate = resolveSubstrate(storeId) as unknown as SubstrateHandle;
        await realSubstrate.withBulkWrite(intent, async (realHandle) => {
          await fn(handle);
          for (const entry of staged.values()) {
            if (entry.committed || !entry.written) continue;
            if (family(entry.storeId) !== 'fs-json') continue;
            if (entry.storeId !== storeId) continue;
            await realHandle.write({ storeId: entry.storeId, key: entry.key, payload: entry.after });
            entry.committed = true;
          }
        });
        return;
      }
      if (fam === 'rvf') {
        const realSubstrate = resolveSubstrate(storeId) as unknown as SubstrateHandle;
        await realSubstrate.withBulkWrite(intent, async (realHandle) => {
          const recordingHandle = makeRvfRecordingHandle(storeId, realHandle as RvfSubstrateHandle);
          await fn(recordingHandle);
        });
        return;
      }
      // sqlite: same reasoning as `withWrite` — bypass the substrate's
      // `withBulkWrite` (which routes to `db.transaction`) and use the
      // bare `.db` under a SAVEPOINT.
      const realSubstrate = resolveSubstrate(storeId);
      const sqliteHandle = realSubstrate as unknown as SqliteSubstrateHandle;
      const stagingHandle = makeSqliteStagingHandle(storeId, sqliteHandle.db);
      await fn(stagingHandle);
    },
  };

  return {
    access: makeSubstrateAccess(handle),
    getStaged: (storeId: StoreId, key: string): StagedEntry | undefined => staged.get(stagingKey(storeId, key)),
    getAllStaged: () => Array.from(staged.values()),
    hasStagedWrites: () => {
      // Any staged write across all three families counts.
      for (const entry of staged.values()) {
        if (entry.written) return true;
      }
      for (const entries of rvfJournal.values()) {
        if (entries.length > 0) return true;
      }
      // SQLite SAVEPOINTs are opened on withWrite entry — their existence
      // signals that the handler entered a write scope.
      return sqliteSavepoints.length > 0;
    },
    commit: async () => {
      // FS-JSON: replay every staged write through the real substrate. Each
      // replay grabs the real `withWrite` lock so the substrate's atomic-write
      // semantics still apply. Entries already committed in-lock during a
      // prior `withWrite` (FS-JSON carve-out path, see above) are skipped —
      // their bytes already landed atomically before the lock released.
      for (const entry of staged.values()) {
        if (!entry.written || entry.committed) continue;
        const substrate = resolveSubstrate(entry.storeId);
        await (substrate as unknown as SubstrateHandle).withWrite(
          { storeId: entry.storeId },
          async (h) => {
            await h.write({ storeId: entry.storeId, key: entry.key, payload: entry.after });
          },
        );
      }
      // RVF: replay journaled inserts/removes through the real backend. Each
      // op routes through the real `RvfSubstrateHandle.rvf` so the crate's
      // atomicity + fsync semantics apply.
      for (const [storeIdStr, entries] of rvfJournal.entries()) {
        if (entries.length === 0) continue;
        const storeId = storeIdStr as StoreId;
        const substrate = resolveSubstrate(storeId);
        await (substrate as unknown as SubstrateHandle).withWrite(
          { storeId },
          async (h) => {
            const rvfHandle = h as RvfSubstrateHandle;
            for (const op of entries) {
              if (op.op === 'insertAsync') {
                await rvfHandle.rvf.insertAsync(op.id, op.embedding, op.metadata);
              } else if (op.op === 'insertBatchAsync') {
                if (typeof (rvfHandle.rvf as { insertBatchAsync?: unknown }).insertBatchAsync === 'function') {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  await (rvfHandle.rvf as any).insertBatchAsync(op.items);
                } else {
                  // Fall back to N insertAsync calls for backends without batch support.
                  for (const item of op.items) {
                    await rvfHandle.rvf.insertAsync(item.id, item.embedding, item.metadata);
                  }
                }
              } else if (op.op === 'removeAsync') {
                await rvfHandle.rvf.removeAsync(op.id);
              }
            }
          },
        );
      }
      // SQLite: RELEASE every SAVEPOINT, in REVERSE order so inner savepoints
      // commit before their outer parent (better-sqlite3 / SQLite require LIFO
      // RELEASE order). The outer surrounding `db.transaction` (opened by
      // `makeSqliteSubstrate.withWrite`) still commits afterward.
      for (let i = sqliteSavepoints.length - 1; i >= 0; i--) {
        const sp = sqliteSavepoints[i];
        sp.db.prepare(`RELEASE SAVEPOINT ${sp.name}`).run();
      }
    },
    rollback: async () => {
      // FS-JSON: NO ROLLBACK. The carve-out path commits FS-JSON writes
      // in-lock during `withWrite` (so concurrent CLI processes don't lose
      // updates). By the time invariant violation or a handler throw runs
      // `rollback()`, the bytes are already on disk and cannot be unwound.
      // This is the explicit trade-off documented at the `withWrite`
      // FS-JSON branch above and at MODULE.md:45: FS-JSON loses
      // invariants-on-staged-state in exchange for durability under
      // concurrent writes. Uncommitted FS-JSON entries (handler threw
      // before `withWrite` returned) were never written to disk — the
      // Map is GC'd with the StagingSubstrate instance.
      // RVF: drop the in-memory journal — no insertAsync/removeAsync ever
      // reached the real backend, so the .rvf file is untouched.
      // SQLite: ROLLBACK TO + RELEASE every SAVEPOINT (REVERSE order — LIFO).
      // The outer surrounding `db.transaction` will then commit successfully
      // (the savepoint rollback only undoes the handler's writes inside it).
      for (let i = sqliteSavepoints.length - 1; i >= 0; i--) {
        const sp = sqliteSavepoints[i];
        try {
          sp.db.prepare(`ROLLBACK TO SAVEPOINT ${sp.name}`).run();
        } finally {
          // RELEASE always runs — without it the SAVEPOINT name stays
          // active on the transaction stack and subsequent ROLLBACK TOs
          // (e.g., from a nested dispatch) would target the wrong scope.
          sp.db.prepare(`RELEASE SAVEPOINT ${sp.name}`).run();
        }
      }
    },
  };
}
