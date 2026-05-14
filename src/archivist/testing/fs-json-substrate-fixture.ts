// charter: testing-surface
// In-memory FS-JSON substrate fixture for handler unit + Phase 5 contention tests.
// Models the file-system JSON family (~18 stores per ADR-0180 §10): hive-state.json,
// agents.json, claims.json, tasks.json, etc. Does NOT touch disk — a Map keyed by
// filename simulates persistent state; a per-filename async mutex simulates the
// withFileLock() primitive in makeFsJsonSubstrate.
//
// The Phase 5 contention-threshold gate (ADR-0180 #20, lines ~790-792) asserts
// against `lockWaits` to detect lock-handling regressions in the 17 FS-JSON
// stores sharing one makeFsJsonSubstrate primitive.

import type {
  BulkIntent,
  StoreId,
  SubstrateAccess,
  SubstrateHandle,
} from '../types.js';

export interface LockWait {
  /** Filename whose lock was contended. */
  readonly file: string;
  /** Wall-clock ms spent waiting for the lock. */
  readonly waitedMs: number;
  /** Wall-clock ms at which the lock was acquired (Date.now()). */
  readonly acquiredAt: number;
}

export type LockHoldMs = number | (() => number);

export interface FsJsonSubstrateFixture extends SubstrateAccess {
  /** Every contention event observed across the fixture's lifetime. */
  readonly lockWaits: LockWait[];
  /** Per-file persistent state; mutate via the substrate interface. */
  readonly files: Map<string, unknown>;
}

export interface MakeFsJsonSubstrateFixtureOpts {
  /**
   * Filenames pre-registered with the fixture. Each gets its own mutex and an
   * initial undefined value in `files` until first write. Stores not listed
   * here are still legal — they're created on first access.
   */
  readonly files: ReadonlyArray<string>;
  /**
   * Synthetic lock-hold duration. If a number, every withWrite holds the mutex
   * that long; if a function, it's called per-acquire (use `() => 5 + Math.random() * 15`
   * for the Phase 5 5–20ms band). Default 0 (no synthetic hold).
   */
  readonly lockHoldMs?: LockHoldMs;
}

/**
 * Build the fixture. The returned object is a branded SubstrateAccess, plus
 * the test-only `lockWaits` and `files` accessors. Handler code typed against
 * SubstrateAccess sees only the branded surface — the extras are invisible to it.
 */
export function makeFsJsonSubstrateFixture(
  opts: MakeFsJsonSubstrateFixtureOpts,
): FsJsonSubstrateFixture {
  const files = new Map<string, unknown>();
  for (const f of opts.files) {
    if (!files.has(f)) files.set(f, undefined);
  }

  const mutexes = new Map<string, Promise<void>>();
  const lockWaits: LockWait[] = [];

  const resolveHoldMs = (): number => {
    if (opts.lockHoldMs === undefined) return 0;
    if (typeof opts.lockHoldMs === 'function') return opts.lockHoldMs();
    return opts.lockHoldMs;
  };

  const acquire = async (file: string): Promise<() => void> => {
    const requestedAt = Date.now();
    const prior = mutexes.get(file) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    mutexes.set(
      file,
      prior.then(() => next),
    );
    await prior;
    const acquiredAt = Date.now();
    const waitedMs = acquiredAt - requestedAt;
    if (waitedMs > 0) {
      lockWaits.push({ file, waitedMs, acquiredAt });
    }
    return () => {
      const hold = resolveHoldMs();
      if (hold > 0) {
        setTimeout(release, hold);
      } else {
        release();
      }
      if (mutexes.get(file) === next) mutexes.delete(file);
    };
  };

  const buildHandle = (boundFile: string | null): SubstrateHandle => ({
    async read<R>(scope: { storeId: StoreId; key: string }): Promise<R | undefined> {
      const filename = boundFile ?? (scope.storeId as string);
      const state = files.get(filename);
      if (state === undefined) return undefined;
      if (state instanceof Map) return state.get(scope.key) as R | undefined;
      if (typeof state === 'object' && state !== null) {
        return (state as Record<string, unknown>)[scope.key] as R | undefined;
      }
      return undefined;
    },

    async write<T>(scope: { storeId: StoreId; key: string; payload: T }): Promise<void> {
      const filename = boundFile ?? (scope.storeId as string);
      let state = files.get(filename);
      if (state === undefined || state === null) {
        state = {} as Record<string, unknown>;
        files.set(filename, state);
      }
      if (state instanceof Map) {
        state.set(scope.key, scope.payload);
      } else if (typeof state === 'object') {
        (state as Record<string, unknown>)[scope.key] = scope.payload;
      } else {
        throw new Error(
          `fs-json-fixture: ${filename} state is ${typeof state}, expected object`,
        );
      }
    },

    async withWrite<T>(
      scope: { storeId: StoreId },
      fn: (handle: SubstrateHandle) => Promise<T>,
    ): Promise<T> {
      const filename = scope.storeId as string;
      const release = await acquire(filename);
      try {
        return await fn(buildHandle(filename));
      } finally {
        release();
      }
    },

    async withBulkWrite(
      intent: BulkIntent,
      fn: (handle: SubstrateHandle) => Promise<void>,
    ): Promise<void> {
      const filename = intent.tableName;
      const release = await acquire(filename);
      try {
        await fn(buildHandle(filename));
      } finally {
        release();
      }
    },
  });

  const handle = buildHandle(null);
  // Brand the handle as SubstrateAccess so it satisfies the opaque type.
  const branded = handle as unknown as SubstrateAccess;

  return Object.assign(branded, { lockWaits, files }) as FsJsonSubstrateFixture;
}
