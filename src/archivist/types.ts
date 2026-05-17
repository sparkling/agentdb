// charter: type-enforcement
// Branded types for the archivist's substrate-handle pattern (ADR-0180 §Type enforcement).
// SubstrateAccess is opaque to store code; instances can only be minted inside the
// archivist runtime via substrate-internal.ts (path-restricted per tsconfig.archivist.json).
// A store's barrel is typed `Record<string, GuardedWrite<any> | GuardedRead<any, any>>`
// so non-branded exports fail at the boundary.

/** Generic nominal-brand helper. */
export type Brand<T, Tag extends string> = T & { readonly __brand: Tag };

/**
 * Opaque substrate-write capability. Reaches handlers exclusively via
 * `MutationContext.substrate`. The shape of the underlying handle (better-sqlite3,
 * RVF, fs-json fixture) is intentionally not exposed at the type level — handlers
 * use the methods documented on `SubstrateHandle` (delegated via the brand).
 */
export type SubstrateAccess = SubstrateHandle & { readonly __brand: 'SubstrateAccess' };

/**
 * Read-only narrowing of `SubstrateAccess`. Delivered via `ReadContext` (no audit,
 * no guard ceremony). Reads cannot acquire write semantics by widening — the brand
 * is incompatible at the type level.
 */
export type ReadOnlySubstrateAccess = ReadOnlySubstrateHandle & {
  readonly __brand: 'ReadOnlySubstrateAccess';
};

/** Store identifier (e.g., 'memory_store', 'agentdb_pattern'). */
export type StoreId = Brand<string, 'StoreId'>;

/** Namespace identifier inside a store (e.g., 'session', 'benchmark-volatile'). */
export type Namespace = Brand<string, 'Namespace'>;

/**
 * Bulk-write intent payload. Per ADR-0180 §Bulk-write mode — one summary audit entry
 * per bulk call carrying `{count, checksum, tableList}`.
 */
export interface BulkIntent {
  readonly tableName: string;
  readonly columnSet: ReadonlyArray<string>;
  readonly count: number;
  readonly checksum: string;
}

/**
 * Underlying substrate handle. Methods are minimal — the archivist composes higher
 * semantics (transactions, witness chains, bulk manifests) above this surface.
 * Stores never see this directly — they receive the branded `SubstrateAccess`.
 */
export interface SubstrateHandle {
  read<R>(scope: { storeId: StoreId; key: string }): Promise<R | undefined>;
  write<T>(scope: { storeId: StoreId; key: string; payload: T }): Promise<void>;
  withWrite<T>(scope: { storeId: StoreId }, fn: (handle: SubstrateHandle) => Promise<T>): Promise<T>;
  withBulkWrite(intent: BulkIntent, fn: (handle: SubstrateHandle) => Promise<void>): Promise<void>;
}

/** Read-only narrowing — `write`/`withWrite`/`withBulkWrite` removed. */
export interface ReadOnlySubstrateHandle {
  read<R>(scope: { storeId: StoreId; key: string }): Promise<R | undefined>;
  query<R>(scope: { storeId: StoreId; predicate: unknown }): Promise<ReadonlyArray<R>>;
  vectorSearch<R>(scope: {
    storeId: StoreId;
    vector: Float32Array;
    topK: number;
  }): Promise<ReadonlyArray<{ item: R; score: number }>>;
  /**
   * ADR-0181 substrate-seam expansion (task #99 commit 1) — `(namespace, key)`
   * lookup. Each substrate honors it natively where the addressing model fits:
   * FS-JSON walks document records, RVF delegates to `RvfBackend.getByKey`
   * (O(1) map lookup, no embedding cost). SQLite throws — it is SQL-addressed,
   * not key/value (`feedback-no-fallbacks`: misroutes fail loud rather than
   * silently no-op). Returns `undefined` on miss; never empty `{}`.
   */
  getByKey<R>(scope: { storeId: StoreId; namespace: string; key: string }): Promise<R | undefined>;
  /**
   * ADR-0181 substrate-seam expansion (task #99 commit 1) — paginated namespace
   * enumeration. `namespace` filter is optional (omitted → all entries in the
   * store). `limit` / `offset` are pagination knobs; `limit` defaults are the
   * substrate's responsibility (`list` without a limit returns every record,
   * which is honest for small FS-JSON files but a footgun for RVF — handlers
   * supply explicit limits per the narrow-projection ruling in the plan §6).
   * SQLite throws (same reason as `getByKey`).
   */
  list<R>(scope: {
    storeId: StoreId;
    namespace?: string;
    limit?: number;
    offset?: number;
  }): Promise<ReadonlyArray<R>>;
}

/**
 * The shape the three substrate factories (`makeFsJsonSubstrate`,
 * `makeSqliteSubstrate`, `makeRvfSubstrate`) actually return at runtime: the
 * write-side `SubstrateHandle` PLUS the read-side `query` / `vectorSearch`
 * methods. The branded `SubstrateAccess` deliberately exposes only
 * `SubstrateHandle` (mutation handlers must not see `query`/`vectorSearch`),
 * so `Archivist.routingReadOnlySubstrate()` resolves a `StoreId` to its
 * write-side `SubstrateAccess` and structurally narrows it to this interface
 * to reach the read-only surface. Each factory implements every member —
 * combinations a given substrate cannot honor (fs-json `vectorSearch`,
 * sqlite/rvf key/value `read`, rvf `query`) throw a documented fail-loud error
 * rather than silently no-op (`feedback-no-fallbacks`).
 */
export type ReadCapableSubstrate = SubstrateHandle &
  Pick<ReadOnlySubstrateHandle, 'query' | 'vectorSearch' | 'getByKey' | 'list'>;

/**
 * Guarded mutation handler. Returned by `registerMutationHandler<T>`. The brand
 * makes non-branded callsites a compile-time error at the store barrel.
 */
export type GuardedWrite<T> = ((ctx: MutationContextLike, payload: T) => Promise<void>) & {
  readonly __brand: 'GuardedWrite';
  readonly __payloadType?: T;
};

/**
 * Guarded read handler. Returned by `registerReadHandler<T, R>`. Same branding
 * discipline as `GuardedWrite` — handlers are not callable without the runtime
 * boundary supplying the contexts.
 */
export type GuardedRead<T, R> = ((ctx: ReadContextLike, payload: T) => Promise<R>) & {
  readonly __brand: 'GuardedRead';
  readonly __payloadType?: T;
  readonly __returnType?: R;
};

// --- Structural shape duplicates ---
// Stored separately from `mutation-context.ts` / `read-context.ts` to break the
// otherwise-circular type dependency between handler brands and context interfaces.
// The runtime modules export the canonical interfaces; these are structural-only
// shadows used in the GuardedWrite/Read signatures above.

import type { GuardVerdict } from './guards-types.js';
import type { MutationCapabilities, ReadCapabilities } from './capabilities.js';

export interface MutationContextLike<HotPath extends boolean = false> {
  readonly auditId: string;
  readonly originatingTool: string;
  readonly guardVerdicts: ReadonlyArray<GuardVerdict>;
  readonly timestamp: number;
  readonly substrate: SubstrateAccess;
  /** Resolved project root — mirrors `MutationContext.projectRoot` (ADR-0180 F4-2 Phase C). */
  readonly projectRoot: string;
  /** Narrow capability bundle — mirrors `MutationContext.capabilities` (ADR-0180 F4-2 Phase C). */
  readonly capabilities: MutationCapabilities;
  readonly child: HotPath extends true ? never : (reason: string) => MutationContextLike<false>;
  readonly bulk: HotPath extends true ? never : (intent: BulkIntent, payload: unknown) => Promise<void>;
}

export interface ReadContextLike {
  readonly originatingTool: string;
  readonly requestId: string;
  readonly intent?: string;
  readonly cacheHints?: {
    readonly wrote_cache: boolean;
    readonly cache_keys: ReadonlyArray<string>;
  };
  readonly cache: {
    get<R>(key: string): R | undefined;
  };
  /** Resolved project root — mirrors `ReadContext.projectRoot` (ADR-0180 F4-2 Phase C). */
  readonly projectRoot: string;
  /** Narrow capability bundle — mirrors `ReadContext.capabilities` (ADR-0180 F4-2 Phase C). */
  readonly capabilities: ReadCapabilities;
}
