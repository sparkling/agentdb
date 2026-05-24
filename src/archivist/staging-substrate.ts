// charter: mutation-invariants
//
// ADR-0246 F-03-002: staged-write proxy that DEFERS FS-JSON substrate commits
// until AFTER the handler returns AND invariants have been evaluated.
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
// The staging substrate routes per-call (`classifyStore`):
//   - FS-JSON family → STAGE: writes accumulate in an in-memory journal; the
//     handler's `read()` calls see prior staged writes layered on top of disk
//     state; nothing reaches disk until `commit()` is called.
//   - RVF + SQLite carve-out family → PASS-THROUGH: substrate commits inside
//     the handler closure as today. Per ADR-0246 §"F-03-002 path (a)
//     mandatory for FS-JSON substrate" — RVF-substrate enforcement is named
//     follow-up (requires `freeze()` + rollback wiring; out of scope this
//     cycle). FS-JSON is feasible today because the substrate is whole-document
//     atomic; staging a write means deferring `saveJsonAtomic`, not unwinding
//     a partial commit.
//
// After the handler returns:
//   - `getStagedFsJsonState({storeId, key})` returns the staged "after" value.
//   - `getInitialFsJsonState({storeId, key})` returns the pre-handler "before"
//     value (loaded on first read or write of that storeId+key pair).
//   - `commit()` replays the staged writes through the real substrate. On
//     pre-commit invariant violation, `commit()` is simply not called — the
//     substrate is untouched.

import type { ReadCapableSubstrate, StoreId, SubstrateAccess, SubstrateHandle, BulkIntent } from './types.js';
import { classifyStore } from './substrate-registry.js';
import { makeSubstrateAccess } from './substrate-internal.js';

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
}

export interface StagingSubstrate {
  /** The branded `SubstrateAccess` to thread onto the handler's context. */
  readonly access: SubstrateAccess;
  /**
   * After the handler returns, replay every staged FS-JSON write through the
   * real substrate. On pre-commit invariant violation, simply do not call
   * `commit()` — staged writes are discarded and disk is untouched.
   */
  commit(): Promise<void>;
  /** The first (and only) entry for a (storeId, key) — `undefined` if never touched. */
  getStaged(storeId: StoreId, key: string): StagedEntry | undefined;
  /** All staged entries (for invariant evaluation across multiple storeIds). */
  getAllStaged(): ReadonlyArray<StagedEntry>;
  /** True if any staged FS-JSON write would have committed. */
  hasStagedWrites(): boolean;
}

/**
 * Build a staging substrate that wraps the archivist's routing substrate.
 *
 * `resolveSubstrate(storeId)` returns the real `SubstrateAccess` for a given
 * storeId — the archivist's `routingSubstrate()` factory minus the handle
 * unwrapping. The staging proxy uses it for both initial loads (`read`,
 * `withWrite.read`) and the final `commit()` replay.
 */
export function makeStagingSubstrate(
  resolveSubstrate: (storeId: StoreId) => SubstrateAccess,
): StagingSubstrate {
  // (storeId|key) → StagedEntry. Map by composite string to avoid the brand
  // collision of using StoreId+key as a tuple key.
  const staged = new Map<string, StagedEntry>();

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
      };
      staged.set(k, entry);
    }
    return entry;
  }

  function isFsJson(storeId: StoreId): boolean {
    return classifyStore(storeId) === 'fs-json';
  }

  /**
   * Build a SubstrateHandle that:
   *   - For FS-JSON: read returns staged `after`; write updates `after`;
   *     withWrite invokes fn with the SAME handle (writes stay staged).
   *   - For RVF / SQLite: pass-through to the real substrate. Per ADR-0246
   *     §"F-03-002 path (a) mandatory for FS-JSON substrate".
   */
  const handle: SubstrateHandle = {
    async read<R>(scope: { storeId: StoreId; key: string }): Promise<R | undefined> {
      if (isFsJson(scope.storeId)) {
        const entry = await ensureEntry(scope.storeId, scope.key);
        return entry.after as R | undefined;
      }
      return (resolveSubstrate(scope.storeId) as unknown as ReadCapableSubstrate).read(scope) as Promise<R | undefined>;
    },

    async write<T>(scope: { storeId: StoreId; key: string; payload: T }): Promise<void> {
      if (isFsJson(scope.storeId)) {
        const entry = await ensureEntry(scope.storeId, scope.key);
        entry.after = scope.payload;
        entry.written = true;
        return;
      }
      // RVF / SQLite: pass through (commits immediately).
      await (resolveSubstrate(scope.storeId) as unknown as SubstrateHandle).write(scope);
    },

    async withWrite<T>(
      scope: { storeId: StoreId },
      fn: (h: SubstrateHandle) => Promise<T>,
    ): Promise<T> {
      if (isFsJson(scope.storeId)) {
        // The staged-write substrate doesn't actually hold the FS-JSON lock
        // for the handler's duration — that would defeat the staging purpose.
        // The real substrate's `withWrite` is invoked at `commit()` time only;
        // during staging, the handler operates against the in-memory journal.
        return fn(handle);
      }
      // RVF / SQLite: pass through; the real substrate's withWrite acquires
      // its own locking / transactional context as today.
      return (resolveSubstrate(scope.storeId) as unknown as SubstrateHandle).withWrite(scope, fn);
    },

    async withBulkWrite(intent: BulkIntent, fn: (h: SubstrateHandle) => Promise<void>): Promise<void> {
      // Bulk writes follow the same family-routing as withWrite — fs-json
      // collapses to whole-document staged writes; rvf/sqlite pass through.
      const storeId = intent.tableName as StoreId;
      if (isFsJson(storeId)) {
        await fn(handle);
        return;
      }
      await (resolveSubstrate(storeId) as unknown as SubstrateHandle).withBulkWrite(intent, fn);
    },
  };

  return {
    access: makeSubstrateAccess(handle),
    getStaged: (storeId: StoreId, key: string): StagedEntry | undefined => staged.get(stagingKey(storeId, key)),
    getAllStaged: () => Array.from(staged.values()),
    hasStagedWrites: () => {
      for (const entry of staged.values()) {
        if (entry.written) return true;
      }
      return false;
    },
    commit: async () => {
      // Replay every staged write through the real substrate. Each replay
      // grabs the real `withWrite` lock so the substrate's atomic-write
      // semantics still apply.
      for (const entry of staged.values()) {
        if (!entry.written) continue;
        const substrate = resolveSubstrate(entry.storeId);
        await (substrate as unknown as SubstrateHandle).withWrite(
          { storeId: entry.storeId },
          async (h) => {
            await h.write({ storeId: entry.storeId, key: entry.key, payload: entry.after });
          },
        );
      }
    },
  };
}
