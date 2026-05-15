// charter: substrate-seam
//
// ADR-0180 Phase 4 §Migration concerns — `makeFsJsonSubstrate` primitive.
//
// Lifted from `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:919-1259`
// (the post-maintenance baseline after the pre-Phase-4 `fix(hive-mind): wrap …`
// commits). The fork's hive-mind module owned this primitive while there was
// no archivist abstraction to consume; the lift moves it into the substrate
// seam where every FS-JSON store can route through it (~17 stores per ADR-0180
// §Caller surfaces Recommendation, lines 467-521).
//
// Durability stack (ADR-0095 d11, ADR-0123 §73, ADR-0098):
//   1. Cross-process O_EXCL sentinel lock at `${path}.lock` (stale-lock recovery
//      after STALE_LOCK_MS).
//   2. Per-pid + per-call counter tmp file (`.tmp.${pid}.${counter}`); concurrent
//      writers in one process never collide on tmp filenames.
//   3. openSync(O_WRONLY|O_CREAT|O_TRUNC) → writeSync → fsyncSync → closeSync.
//      The explicit fsync drains the VFS page cache for the tmp data blocks
//      BEFORE the rename promotes the entry — closes the Mode A entry-count
//      silent-loss window observed on APFS under concurrent load.
//   4. renameSync(tmp, target) — atomic at the directory-entry layer.
//   5. cache.set(key, payload) AFTER the rename succeeds. On any throw above,
//      the cache is NOT updated (no advertising of partial state).
//
// Power-loss durability (fsync of the directory entry after rename) is OUT OF
// SCOPE here — ADR-0130 owns it. The gate this primitive closes is
// SIGKILL-without-power-loss: the kernel page cache outlives a process kill,
// so post-rename data is recoverable on the next mount.
//
// Self-contained: this module is the production substrate for `forks/agentdb`
// and does NOT import from `forks/ruflo`. The hive-mind-tools.ts code stays
// in place until Phase 4 migrators wire consumers through `ctx.substrate.withWrite`.
//
// ── Multi-file primitive (`writeMultiFileAtomic`, ADR-0180 OF#11) ─────────────
// F4-2 Phase C adds `writeMultiFileAtomic` below: the N-file commit primitive
// the `daemon_runConsolidate` and `daemon_autoMemoryBridge` handlers need.
// `makeFsJsonSubstrate` is single-document (`withWrite` rewrites ONE file);
// OF#11's consolidation pass writes THREE artifacts (`ranked-context.json` +
// `graph-state.json` + `intelligence-snapshot.json`) as one intent, and
// AutoMemoryBridge writes `MEMORY.md` + per-topic markdown files. Those callers
// have no single `StoreId` → one-file route, so the multi-file primitive takes
// N explicit `{ path, payload }` targets directly rather than routing through
// the `StoreId` seam. Atomicity is honest-partial — see its doc-block: true
// N-file POSIX atomicity needs a single-directory staging swap, and these
// targets span directories (`metrics/` + `data/`, or `<memoryDir>/*.md`), so
// the primitive does tmp+fsync-per-file then rename-commit-in-sequence and
// reports a `partial` result with a `committedPaths` prefix on mid-sequence
// failure. ADR-0180 §Confirmation handles `partial` explicitly — `partial`
// audit entries assert only their declared committed-prefix subset.

import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { makeSubstrateAccess } from '../substrate-internal.js';
import type {
  BulkIntent,
  ReadCapableSubstrate,
  StoreId,
  SubstrateAccess,
  SubstrateHandle,
} from '../types.js';

// ── Lock-acquire tuning (matches hive-mind-tools.ts:1215-1218) ────────────────

const MAX_WAIT_MS = 5_000;
const POLL_MS = 50;
const STALE_LOCK_MS = 30_000;

// Per-process tmp-name counter ensures concurrent writers in the same process
// never collide on tmp filenames. Mirrors RVF's _tmpCounter pattern
// (rvf-backend.ts:2512) and hive-mind-tools.ts:1209.
let tmpCounter = 0;

// ── Options ──────────────────────────────────────────────────────────────────

/**
 * Configuration for `makeFsJsonSubstrate`. The three shims (`dir`, `defaults`,
 * `migrate`) cover the Q4 audit list per ADR-0180 §Migration concerns Phase 4:
 * directory must be ensure-created lazily, missing-file reads return a typed
 * sentinel, and legacy state shapes round-trip through a caller-supplied
 * migration callback.
 */
export interface MakeFsJsonSubstrateOpts<S> {
  /** Absolute path of the JSON file the substrate owns. */
  readonly path: string;
  /**
   * Optional process-local LRU cache. The substrate writes to it AFTER the
   * rename succeeds and reads from it on a hit; cache invalidation on miss is
   * the caller's concern. When omitted, every read hits disk.
   */
  readonly cache?: Map<string, S>;
  /**
   * Sentinel returned when the file does not exist on disk. Without this, a
   * read of a never-created file would surface `undefined` to handlers, which
   * is ambiguous with a successfully-read empty document.
   */
  readonly defaults?: S;
  /**
   * Optional one-shot migration applied to parsed JSON before it is returned
   * to the handler. Useful for legacy state-shape upgrades that the substrate
   * must perform inside the lock to avoid race-windows where a handler
   * re-saves a half-migrated document.
   */
  readonly migrate?: (raw: unknown) => S;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * POSIX O_EXCL sentinel lock with stale-lock recovery. Mirrors
 * `withHiveStoreLock` at hive-mind-tools.ts:1213-1259. Cross-process safe
 * because the kernel guarantees O_CREAT|O_EXCL atomicity at the inode layer.
 *
 * Stale-lock recovery: a sentinel older than STALE_LOCK_MS is unlinked and
 * re-acquired (the prior holder crashed or hung). The window is intentionally
 * wide (30 s) — false positives would corrupt a real concurrent writer's view.
 */
async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  ensureParentDir(lockPath);
  const deadline = Date.now() + MAX_WAIT_MS;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const fd = openSync(
        lockPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
        0o600,
      );
      writeSync(fd, `${process.pid}\n${Date.now()}\n`);
      closeSync(fd);
      break;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'EEXIST') throw err;

      try {
        const stat = statSync(lockPath);
        if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
          try { unlinkSync(lockPath); } catch { /* lockfile vanished — retry */ }
          continue;
        }
      } catch { /* lockfile vanished between EEXIST and stat — retry */ }

      if (Date.now() > deadline) {
        throw new Error(`Timeout waiting for fs-json substrate lock at ${lockPath} after ${MAX_WAIT_MS}ms`);
      }
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  }

  try {
    return await fn();
  } finally {
    try { unlinkSync(lockPath); } catch { /* already removed */ }
  }
}

/**
 * Load the JSON file, apply optional migration, populate cache on success.
 * A non-existent file returns `defaults` (when supplied) or `undefined`.
 * A corrupt file throws — per `feedback-no-fallbacks`, silent fallback to
 * defaults would overwrite recoverable corruption on the next write.
 */
function loadJson<S>(opts: MakeFsJsonSubstrateOpts<S>): S | undefined {
  if (opts.cache) {
    const cached = opts.cache.get(opts.path);
    if (cached !== undefined) return cached;
  }

  if (!existsSync(opts.path)) {
    return opts.defaults;
  }

  const raw = readFileSync(opts.path, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  const value = opts.migrate ? opts.migrate(parsed) : (parsed as S);

  if (opts.cache) {
    opts.cache.set(opts.path, value);
  }
  return value;
}

/**
 * Write the JSON file atomically: tmp + fsync + rename, then update cache.
 * Cache update ordering matches hive-mind-tools.ts:1206 — only after the
 * rename succeeds. On any throw above, the cache reflects the pre-call state.
 */
function saveJsonAtomic<S>(opts: MakeFsJsonSubstrateOpts<S>, payload: S): void {
  ensureParentDir(opts.path);

  const tmp = `${opts.path}.tmp.${process.pid}.${tmpCounter++}`;
  let fd: number | null = null;
  try {
    fd = openSync(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC, 0o600);
    writeSync(fd, JSON.stringify(payload, null, 2), 0, 'utf-8');
    fsyncSync(fd);
  } finally {
    if (fd !== null) closeSync(fd);
  }
  renameSync(tmp, opts.path);

  if (opts.cache) {
    opts.cache.set(opts.path, payload);
  }
}

// ── Read-only `query` predicate shape ────────────────────────────────────────
//
// `ReadOnlySubstrateHandle.query` types `scope.predicate` as `unknown`. For the
// FS-JSON whole-document substrate the predicate is a `(record) => boolean`
// FUNCTION — the simplest substrate-generic primitive (the alternative, a
// structured `{field, op, value}` DSL, would re-implement the MongoDB-style
// filter the agentdb read handlers already own at the handler layer). `query`
// loads the document and applies the predicate to its RECORDS:
//
//   - document is an array  → records are its elements.
//   - document is an object → records are its top-level VALUES (the
//     `agents.json` `{ agents: { id → record } }` shape, or any
//     `Record<id, record>` collection).
//
// A store whose document is a single scalar/leaf (no collection) returns `[]` —
// not an error: an absent collection legitimately has zero records. A
// non-function predicate, by contrast, fails loud (`feedback-no-fallbacks`) —
// a mistyped predicate must not silently match nothing.

/** Predicate function for `FsJsonSubstrate.query` — `true` keeps the record. */
export type FsJsonQueryPredicate<R = unknown> = (record: R) => boolean;

/** Narrow an `unknown` predicate to a function, throwing on mismatch. */
function asFsJsonQueryPredicate(predicate: unknown, storeId: StoreId): FsJsonQueryPredicate {
  if (typeof predicate !== 'function') {
    throw new Error(
      `makeFsJsonSubstrate: query predicate for store '${storeId as string}' must be a ` +
        `(record) => boolean function — the FS-JSON substrate runs a predicate scan over the document's records`,
    );
  }
  return predicate as FsJsonQueryPredicate;
}

/** Records of a parsed FS-JSON document: array elements, or object values. */
function documentRecords(doc: unknown): ReadonlyArray<unknown> {
  if (Array.isArray(doc)) return doc;
  if (doc !== null && typeof doc === 'object') return Object.values(doc as Record<string, unknown>);
  // Scalar/leaf document — no collection to scan. Zero records is the honest
  // answer (not an error: the store legitimately holds no record collection).
  return [];
}

// ── Public factory ───────────────────────────────────────────────────────────

/**
 * Build an FS-JSON `SubstrateAccess` for a single JSON-document path.
 *
 * The seam is whole-document — the JSON file represents one logical record.
 * `handle.read({ storeId, key })` and `handle.write({ storeId, key, payload })`
 * treat `key` as a top-level field of the parsed document; `withWrite`
 * delivers an inner handle whose read/write run inside the lock, and the
 * write completes atomically via tmp+fsync+rename before the cache is
 * updated.
 *
 * `withBulkWrite` delegates to `withWrite` — fs-json files are atomically
 * rewritten on every commit, so bulk semantics collapse to a single atomic
 * write. The archivist emits the bulk manifest one layer up; the substrate
 * only owns durability.
 *
 * The returned handle also carries the read-only `query` / `vectorSearch`
 * surface (`ReadCapableSubstrate`) consumed by the read-dispatch router:
 *   - `query({ storeId, predicate })` runs `predicate` (a `(record) => boolean`
 *     function) over the document's records (array elements, or object values)
 *     and returns the matches.
 *   - `vectorSearch(...)` throws: FS-JSON has no vector index — a vector query
 *     routed to an FS-JSON-family store is a misroute (the store should
 *     classify to the RVF family).
 *
 * @example
 *   const cache = new Map<string, HiveState>();
 *   const substrate = makeFsJsonSubstrate<HiveState>({
 *     path: '/proj/.claude-flow/hive-mind/state.json',
 *     cache,
 *     defaults: defaultHiveState(),
 *     migrate: migrateLegacyShape,
 *   });
 *   await substrate.withWrite({ storeId }, async (handle) => {
 *     const cur = await handle.read({ storeId, key: 'root' }) ?? defaults;
 *     cur.workers.push(newWorker);
 *     await handle.write({ storeId, key: 'root', payload: cur });
 *   });
 */
export function makeFsJsonSubstrate<S>(opts: MakeFsJsonSubstrateOpts<S>): SubstrateAccess {
  const lockPath = `${opts.path}.lock`;

  // Document representation: parsed JSON is treated as a `Record<string, unknown>`
  // whose top-level keys are addressable via `scope.key`. The convention
  // matches the in-memory FS-JSON fixture at `archivist/testing/fs-json-substrate-fixture.ts`
  // so a swap of fixture-for-production keeps handler tests passing
  // (substrate-genericity.test.ts contract).
  // ADR-0181 Phase 6 — 'root' key is whole-document
  //
  // Every hive-mind/swarm/task/agent/claim/workflow handler in
  // `archivist/handlers/**` writes its top-level state under `key: 'root'`
  // (the convention established by `COORD_STORE_KEY = 'root'` in
  // `handlers/coordination/shared.ts` and mirrored across families).
  // Wrapping that state under a `{root: ...}` object adds a level of
  // indirection that breaks every cli reader doing
  // `JSON.parse(readFileSync(<store>)).agents` etc. To restore parity
  // with the cli's flat-file convention, treat `'root'` as
  // whole-document: read returns the entire doc; write replaces the
  // entire doc. Other keys (none exist as of 2026-05-15, but future
  // multi-keyed FS-JSON consumers stay accommodated) still address
  // top-level fields via `setField`.
  //
  // This is NOT a silent fallback (feedback-no-fallbacks) — it's the
  // intentional convention: every existing handler ASKED for the whole
  // doc by passing `key: 'root'`. The wrapping was an implementation
  // artifact that the original 'root' convention was working around.
  const getField = (doc: unknown, key: string): unknown => {
    if (doc === undefined || doc === null) return undefined;
    if (typeof doc !== 'object') return undefined;
    if (key === 'root') {
      const asRecord = doc as Record<string, unknown>;
      // Back-compat: legacy docs that landed under `.root` (pre-this-patch
      // writes; the cli's `loadHiveState`/`loadAgentStore` unwrap path).
      // Prefer the wrapped value if present; otherwise return the whole doc.
      const rootField = asRecord.root;
      if (rootField !== undefined && rootField !== null && typeof rootField === 'object') {
        return rootField;
      }
      return doc;
    }
    return (doc as Record<string, unknown>)[key];
  };

  const setField = (doc: unknown, key: string, value: unknown): Record<string, unknown> => {
    if (key === 'root') {
      // Whole-document write. If the existing doc has a `.root` field
      // (legacy wrapped shape from pre-this-patch writes), prefer the
      // unwrapped overlay so a subsequent read sees the new state at
      // top level. Otherwise just write the payload as the whole doc.
      const base = (value && typeof value === 'object')
        ? (value as Record<string, unknown>)
        : ({} as Record<string, unknown>);
      return base;
    }
    const base = (doc && typeof doc === 'object')
      ? (doc as Record<string, unknown>)
      : ({} as Record<string, unknown>);
    base[key] = value;
    return base;
  };

  const handle: ReadCapableSubstrate = {
    async read<R>(scope: { storeId: StoreId; key: string }): Promise<R | undefined> {
      void scope.storeId;
      const doc = loadJson(opts);
      return getField(doc, scope.key) as R | undefined;
    },

    async write<T>(scope: { storeId: StoreId; key: string; payload: T }): Promise<void> {
      void scope.storeId;
      const current = loadJson(opts);
      const next = setField(current, scope.key, scope.payload) as unknown as S;
      saveJsonAtomic(opts, next);
    },

    async withWrite<T>(
      scope: { storeId: StoreId },
      fn: (h: SubstrateHandle) => Promise<T>,
    ): Promise<T> {
      void scope.storeId;
      return withFileLock(lockPath, async () => fn(handle));
    },

    async withBulkWrite(
      intent: BulkIntent,
      fn: (h: SubstrateHandle) => Promise<void>,
    ): Promise<void> {
      // fs-json: one atomic file rewrite per commit; bulk collapses to withWrite.
      // The archivist owns the bulk-manifest audit emission; this substrate only
      // owns durability + isolation.
      void intent;
      await withFileLock(lockPath, async () => fn(handle));
    },

    // ── Read-only surface (ReadCapableSubstrate) ─────────────────────────────

    async query<R>(scope: { storeId: StoreId; predicate: unknown }): Promise<ReadonlyArray<R>> {
      // Predicate scan over the document's records. Unlocked: reads carry no
      // audit ceremony (ADR-0180 §Audit chain), and a single `loadJson` is a
      // consistent point-in-time snapshot (the document is rewritten atomically
      // by `saveJsonAtomic` — a concurrent writer's rename either has or has
      // not landed; there is no torn read).
      void scope.storeId;
      const predicate = asFsJsonQueryPredicate(scope.predicate, scope.storeId);
      const doc = loadJson(opts);
      return documentRecords(doc).filter((record) => predicate(record)) as ReadonlyArray<R>;
    },

    async vectorSearch<R>(scope: {
      storeId: StoreId;
      vector: Float32Array;
      topK: number;
    }): Promise<ReadonlyArray<{ item: R; score: number }>> {
      // Throw-by-design: the FS-JSON substrate is a whole-document JSON store —
      // there is no vector index, no HNSW, no similarity primitive. A
      // `vectorSearch` routed to an FS-JSON-family storeId is a routing bug: the
      // store should classify to the RVF family (substrate-registry.ts
      // `RVF_STORE_IDS`). Fail loud rather than silent-empty
      // (`feedback-no-fallbacks`).
      void scope.vector;
      void scope.topK;
      throw new Error(
        `makeFsJsonSubstrate: vectorSearch is not available — store '${scope.storeId as string}' ` +
          `resolves to the FS-JSON substrate, which has no vector index. ` +
          `A vector query must route to an RVF-family store.`,
      );
    },
  };

  return makeSubstrateAccess(handle);
}

// ── Multi-file atomic-write primitive (ADR-0180 OF#11, F4-2 Phase C) ──────────

/**
 * One file target for `writeMultiFileAtomic`. `payload` is what lands on disk:
 *
 *   - `{ json: <value> }` — the value is `JSON.stringify`'d with 2-space indent
 *     (the `makeFsJsonSubstrate` `saveJsonAtomic` convention). Used by
 *     `daemon_runConsolidate`'s three JSON artifacts.
 *   - `string` — written verbatim, no encode. Used by `daemon_autoMemoryBridge`'s
 *     `MEMORY.md` + per-topic `<category>.md` files. The fs-json substrate is
 *     JSON-only (`saveJsonAtomic` `JSON.stringify`s everything); markdown callers
 *     need the raw-string path, which this discriminator gives them without a
 *     second substrate family.
 *
 * `path` is the absolute destination. Parent directories are `mkdir -p`'d before
 * the tmp write — the OF#11 targets span `.claude-flow/metrics/` and
 * `.claude-flow/data/` (and `<memoryDir>/` for AutoMemoryBridge), none of which
 * a caller can assume exists.
 */
export interface MultiFileTarget {
  /** Absolute destination path. */
  readonly path: string;
  /**
   * `{ json }` → 2-space-indented `JSON.stringify`; `string` → verbatim bytes.
   * The discriminator is what lets one primitive serve both the JSON-artifact
   * consolidate caller and the markdown AutoMemoryBridge caller.
   */
  readonly payload: string | { readonly json: unknown };
}

/**
 * Result of a `writeMultiFileAtomic` call. Honest about the partial-failure
 * contract per ADR-0180 §Confirmation:
 *
 *   - `state: 'applied'` — every rename committed; `committedPaths` is the full
 *     target set, `failedPath` / `error` absent.
 *   - `state: 'partial'` — the tmp+fsync staging phase succeeded for all targets
 *     but a `renameSync` failed mid-sequence. `committedPaths` is the
 *     rename-committed PREFIX (the targets whose rename ran before the failure);
 *     `failedPath` is the target whose rename threw; `error` is that throw. The
 *     caller's audit entry MUST record `state: 'partial'` and assert only
 *     `committedPaths` — ADR-0180 §Confirmation: "`partial` entries assert only
 *     their declared `committed-prefix` subset". Already-committed renames are
 *     NOT rolled back (the archivist does not do compensating writes —
 *     §Transactions and partial failure).
 *
 * `state: 'partial'` is NOT thrown — it is returned, so the caller can finalize
 * its audit entry with the correct state + committed prefix. A staging-phase
 * failure (before ANY rename) DOES throw: nothing was committed, so it is an
 * ordinary `failed` intent with no prefix to assert, and a throw is the honest
 * signal (`feedback-no-fallbacks` — no silent half-state).
 */
export interface MultiFileWriteResult {
  readonly state: 'applied' | 'partial';
  /** Rename-committed paths. Full target set on `applied`; the prefix on `partial`. */
  readonly committedPaths: ReadonlyArray<string>;
  /** The target whose `renameSync` threw — `partial` only. */
  readonly failedPath?: string;
  /** The `renameSync` throw — `partial` only. */
  readonly error?: unknown;
}

/** Serialize a `MultiFileTarget.payload` to the bytes that hit the tmp file. */
function serializeTarget(payload: MultiFileTarget['payload']): string {
  if (typeof payload === 'string') return payload;
  return JSON.stringify(payload.json, null, 2);
}

/**
 * Stage one target: `mkdir -p` its parent, write a per-pid+counter tmp file,
 * fsync it, close it. Returns the tmp path for the later rename-commit. Throws
 * on any IO error — the caller aborts the whole batch before any rename runs.
 *
 * Mirrors `saveJsonAtomic`'s durability stack (open O_WRONLY|O_CREAT|O_TRUNC →
 * write → fsync → close) so the multi-file primitive has the same SIGKILL-
 * without-power-loss guarantee per target. Power-loss durability (directory-
 * entry fsync after rename) stays OUT OF SCOPE — ADR-0130 owns it.
 */
function stageMultiFileTarget(target: MultiFileTarget): string {
  ensureParentDir(target.path);
  const tmp = `${target.path}.tmp.${process.pid}.${tmpCounter++}`;
  let fd: number | null = null;
  try {
    fd = openSync(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC, 0o600);
    writeSync(fd, serializeTarget(target.payload), 0, 'utf-8');
    fsyncSync(fd);
  } finally {
    if (fd !== null) closeSync(fd);
  }
  return tmp;
}

/**
 * Atomically commit N files as one intent (ADR-0180 OF#11, F4-2 Phase C).
 *
 * The single-document `makeFsJsonSubstrate` cannot express this — `withWrite`
 * rewrites ONE file. OF#11's consolidation pass writes THREE JSON artifacts in
 * one logical intent, and `daemon_autoMemoryBridge` writes `MEMORY.md` plus
 * per-topic markdown files. This primitive is what those handlers consume to
 * stage + commit all targets under one lock.
 *
 * **Atomicity contract — honest partial.** True N-file atomicity on POSIX needs
 * a single-directory staging swap (rename a whole staging dir over the live
 * dir in one `renameSync`). The OF#11 targets span directories — consolidation
 * writes into `.claude-flow/metrics/` and `.claude-flow/data/`; AutoMemoryBridge
 * writes into `<memoryDir>/` — so a single-dir swap is not available. The
 * primitive therefore does **two phases**:
 *
 *   1. **Stage** — every target written to a tmp file + fsync'd. If ANY stage
 *      throws, NOTHING has been renamed: the function throws, the caller treats
 *      it as a `failed` intent (no committed prefix to assert). Tmp files from
 *      already-staged targets are best-effort unlinked on the way out.
 *   2. **Commit** — `renameSync(tmp, target)` for each target, in `files` order.
 *      Each rename is atomic at the directory-entry layer. If a rename fails
 *      mid-sequence, the already-renamed targets ARE committed — that is a
 *      `partial` state, RETURNED (not thrown) as `{ state: 'partial',
 *      committedPaths: <prefix>, failedPath, error }`. The remaining unstaged
 *      tmp files are best-effort unlinked. ADR-0180 §Confirmation explicitly
 *      handles `partial`: the caller's audit entry records `state: 'partial'`
 *      and asserts ONLY the `committedPaths` prefix; no compensating rollback
 *      of the committed prefix (§Transactions and partial failure — running
 *      averages, autoincrement IDs, auto-promotion triggers cannot be inverted).
 *
 * **Isolation.** The whole stage+commit runs under one O_EXCL sentinel lock at
 * `lockPath` (caller-supplied — typically a stable per-intent path like
 * `<projectRoot>/.claude-flow/data/.consolidation-multifile.lock`). Concurrent
 * `writeMultiFileAtomic` calls for the same intent serialize; the lock is the
 * same `withFileLock` the single-document substrate uses, with the same stale-
 * lock recovery after `STALE_LOCK_MS`.
 *
 * **Ordering matters.** Renames commit in `files` array order, so the caller
 * controls the `committed-prefix` semantics: put the artifact whose presence is
 * the "this intent ran" signal LAST, so a `partial` failure never advertises a
 * completed intent. For consolidation that is `intelligence-snapshot.json` (the
 * hooks delta-tracking file) — list it last.
 *
 * @param lockPath  Absolute path of the O_EXCL sentinel lock for this intent.
 * @param files     The N targets. Renamed in array order; see "Ordering matters".
 * @returns `{ state: 'applied', committedPaths }` on full success, or
 *          `{ state: 'partial', committedPaths, failedPath, error }` on a
 *          mid-commit rename failure. Throws only on a staging-phase failure
 *          (nothing committed) or lock-acquire timeout.
 *
 * @example
 *   // daemon_runConsolidate — three JSON artifacts, one intent
 *   const result = await writeMultiFileAtomic(
 *     join(projectRoot, '.claude-flow/data/.consolidation-multifile.lock'),
 *     [
 *       { path: rankedContextPath, payload: { json: rankedContext } },
 *       { path: graphStatePath,    payload: { json: graphState } },
 *       { path: snapshotPath,      payload: { json: snapshot } }, // signal file LAST
 *     ],
 *   );
 *   // audit: result.state === 'applied' ? applied : partial(result.committedPaths)
 *
 * @example
 *   // daemon_autoMemoryBridge — MEMORY.md index + per-topic markdown, raw strings
 *   await writeMultiFileAtomic(
 *     join(memoryDir, '.auto-memory-multifile.lock'),
 *     [
 *       { path: join(memoryDir, 'feedback.md'), payload: topicMarkdown },
 *       { path: join(memoryDir, 'MEMORY.md'),   payload: indexMarkdown }, // index LAST
 *     ],
 *   );
 */
export async function writeMultiFileAtomic(
  lockPath: string,
  files: ReadonlyArray<MultiFileTarget>,
): Promise<MultiFileWriteResult> {
  if (files.length === 0) {
    // Empty batch is a caller bug, not a no-op to swallow (`feedback-no-fallbacks`):
    // a multi-file intent with zero targets means the caller computed nothing to
    // write and should not have dispatched.
    throw new Error('writeMultiFileAtomic: called with an empty `files` array — nothing to commit');
  }

  return withFileLock(lockPath, async (): Promise<MultiFileWriteResult> => {
    // ── Phase 1: stage every target (tmp + fsync). Abort the whole batch on
    // any failure — nothing has been renamed, so this is a clean `failed`.
    const tmpPaths: string[] = [];
    try {
      for (const target of files) {
        tmpPaths.push(stageMultiFileTarget(target));
      }
    } catch (stageErr) {
      // Best-effort cleanup of the tmp files staged before the failure. The
      // throw propagates: the caller records a `failed` intent — no committed
      // prefix exists to assert.
      for (const tmp of tmpPaths) {
        try { unlinkSync(tmp); } catch { /* tmp already gone */ }
      }
      throw stageErr;
    }

    // ── Phase 2: commit. Rename each tmp → target in `files` order. A
    // mid-sequence failure leaves the already-renamed prefix committed —
    // returned as `partial`, NOT thrown (ADR-0180 §Confirmation).
    const committedPaths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const target = files[i];
      const tmp = tmpPaths[i];
      try {
        renameSync(tmp, target.path);
        committedPaths.push(target.path);
      } catch (renameErr) {
        // Best-effort unlink of the not-yet-committed tmp files (this one + the
        // rest). The committed prefix is NOT rolled back — the archivist does
        // no compensating writes (ADR-0180 §Transactions and partial failure).
        for (let j = i; j < tmpPaths.length; j++) {
          try { unlinkSync(tmpPaths[j]); } catch { /* tmp already gone */ }
        }
        return {
          state: 'partial',
          committedPaths,
          failedPath: target.path,
          error: renameErr,
        };
      }
    }

    return { state: 'applied', committedPaths };
  });
}
