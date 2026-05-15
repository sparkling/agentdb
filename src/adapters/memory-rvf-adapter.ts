/**
 * MemoryRvfAdapter — bridges `@claude-flow/memory`'s `RvfBackend` (an
 * `IMemoryBackend`-shaped object built around MemoryEntry records) into
 * agentdb's `VectorBackendAsync` interface (pure vector + metadata).
 *
 * ADR-0181 Phase 4 §Amendment — team-lead Option A ruling: a typed adapter
 * collapses Phase 3's `memory_search_index` indirection and routes all RVF
 * operations through one HNSW index. The cli holds the memory `RvfBackend`
 * (its primary memory substrate) and passes this adapter to
 * `Archivist.initialize({ rvfBackend })` so the archivist's RVF-family stores
 * read and write the same vector space.
 *
 * Typing strategy: agentdb has no package-level dependency on
 * `@claude-flow/memory` / `@sparkleideas/memory` (see `forks/agentdb/package.json`
 * — neither is listed). Declaring those types in the adapter directly would
 * require a runtime import that ESM resolution cannot satisfy. Instead, the
 * adapter constructor accepts a *structural* `IMemoryRvfBackend` — the narrow
 * subset of `IMemoryBackend` the adapter actually calls. The published
 * `RvfBackend` from `@claude-flow/memory` structurally satisfies this
 * interface; consumers in `cli/src/...` pass it directly with no cast.
 *
 * Lossy fields when downcasting `BackendStats` → `VectorStats`:
 *   - `entriesByNamespace`, `entriesByType`, `cacheStats`, `avgQueryTime`,
 *     `avgSearchTime` are dropped (no equivalent in `VectorStats`).
 *   - `dimension` is sourced from `getStoredDimension()` (not on
 *     `BackendStats`), or from the constructor `dimensions` hint if
 *     `getStoredDimension()` returns 0 (empty store).
 *   - `metric` is reported from the adapter config (memory's `getStats()`
 *     does not surface the metric).
 *
 * Sync methods on `VectorBackendAsync` (inherited from `VectorBackend`) throw
 * `MemoryRvfAdapterSyncUnsupportedError` — memory's backend is async-only;
 * silently buffering would violate `feedback-no-fallbacks`.
 *
 * ─── Cross-store visibility (Option A bleed-through) ─────────────────────────
 *
 * Because the adapter mints real `MemoryEntry` records into the same
 * `IMemoryRvfBackend` the cli's `memory list` / `memory_search` already reads,
 * every archivist RVF write surfaces in the user-facing memory namespace.
 * `buildEntry` sets `namespace: 'agentdb-vector'` (overridable via
 * `defaultNamespace` config, or per-call via `metadata.namespace`) so memory
 * tooling can filter these out by namespace, but no automatic exclusion is
 * wired here — Option B (a separate `.rvf` path) was the only way to avoid
 * this without changes outside the adapter, and team-lead ruled Option A.
 * This is the real semantic cost of the ruling and is documented (not
 * concealed) here.
 *
 * ─── Lifecycle ownership (DA-3 / DA-4 audit) ─────────────────────────────────
 *
 * Grep on `forks/agentdb/src/{backends,archivist}` shows the archivist tree
 * never calls `.close()` on a `VectorBackendAsync` — the archivist substrate
 * factories `import type` their backend handles, they do NOT own lifecycle.
 * Lifecycle is owned by whoever constructed the underlying `IMemoryRvfBackend`
 * (the cli's `memory-router.ts`). `save(path)`/`load(path)` are likewise never
 * invoked by the archivist on this adapter — the one internal agentdb caller
 * of `rvfBackend.save(targetRvfPath)` (`src/cli/commands/migrate.ts:257`)
 * operates on its OWN privately-constructed concrete `RvfBackend`, not on a
 * substrate-supplied `VectorBackendAsync`, so it never reaches this adapter.
 * Re-verify on agentdb internals drift with:
 *   `rg "\.close\(\)" forks/agentdb/src/{backends,archivist} --type ts`
 *   `rg "\.save\(['\"]" forks/agentdb/src --type ts | rg -v test`
 *
 * ─── No-op flush justification (DA-5 citation) ───────────────────────────────
 *
 * `flush()` is a no-op because memory's `RvfBackend` writes eagerly inside
 * every `store()` / `bulkInsert()` call — there is no buffered sync write for
 * the adapter to drain. See `forks/ruflo/v3/@claude-flow/memory/src/rvf-
 * backend.ts`:
 *   - `RvfBackend.store(entry)` at line 430 awaits `appendToWal(entry)` at
 *     line 501 (the awaited fdatasync/fsync is inside the JS lock region —
 *     line 2117-2122 / 2128).
 *   - `RvfBackend.bulkInsert(entries)` at ~line 830 awaits the same
 *     `appendToWal` at line 838 per entry.
 *   - Auto-compaction trips `compactWal()` at line 2358 when WAL size crosses
 *     `walCompactionThreshold`.
 *
 * ─── Score range (DA-bonus citation) ─────────────────────────────────────────
 *
 * `MemorySearchResultShape.score` maps to `AgentdbSearchResult.similarity`
 * verbatim. Range characterization, sourced from memory's `RvfBackend.search`:
 *   - Native path: score is converted from distance at memory line 717-720.
 *     Cosine: `1 - distance` ∈ [0, 1] for unit vectors (memory's intended
 *     contract). Euclidean: `1 / (1 + distance)` ∈ (0, 1]. Dot product:
 *     `distance` itself, range UNBOUNDED — out-of-band for `similarity`'s
 *     documented [0, 1] range but is what memory returns; the adapter does
 *     not re-normalize (no honest mapping exists without knowing vector
 *     magnitudes).
 *   - Pure-TS / brute-force fallback: `cosineSimilarity()` at memory line
 *     1877, range [-1, 1] mathematically though [0, 1] for non-negative
 *     embeddings (the project default).
 * The adapter's documented [0, 1] holds for cosine + euclidean metrics, the
 * two used by every project default. Dot-product metric is a caller-supplied
 * choice and signals the caller has accepted the unbounded-similarity tradeoff.
 */

import type {
  VectorBackendAsync,
  SearchResult as AgentdbSearchResult,
  SearchOptions as AgentdbSearchOptions,
  VectorStats,
} from '../backends/VectorBackend.js';

// ─── Structural source interface (no package dep on @claude-flow/memory) ───

/**
 * Narrow structural subset of `@claude-flow/memory`'s `MemoryEntry`. Mirrors
 * `forks/ruflo/v3/@claude-flow/memory/src/types.ts:MemoryEntry`. The adapter
 * builds these from the inputs `VectorBackendAsync` callers provide (id,
 * embedding, metadata) and supplies sane defaults for the fields the memory
 * backend requires.
 */
export interface MemoryEntryShape {
  readonly id: string;
  readonly key: string;
  readonly content: string;
  readonly embedding?: Float32Array;
  readonly type: 'episodic' | 'semantic' | 'procedural' | 'working' | 'cache';
  readonly namespace: string;
  readonly tags: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly accessLevel: 'private' | 'team' | 'swarm' | 'public' | 'system';
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly version: number;
  readonly references: readonly string[];
  readonly accessCount: number;
  readonly lastAccessedAt: number;
}

/** Narrow structural mirror of `@claude-flow/memory`'s `SearchOptions`. */
export interface MemorySearchOptionsShape {
  readonly k: number;
  readonly threshold?: number;
}

/** Narrow structural mirror of `@claude-flow/memory`'s `SearchResult`. */
export interface MemorySearchResultShape {
  readonly entry: MemoryEntryShape;
  readonly score: number;
  readonly distance: number;
}

/** Narrow structural mirror of `@claude-flow/memory`'s `BackendStats`. */
export interface MemoryBackendStatsShape {
  readonly totalEntries: number;
  readonly memoryUsage: number;
}

/**
 * Narrow structural mirror of `@claude-flow/memory`'s `IMemoryBackend`,
 * trimmed to exactly the methods this adapter invokes. The cli's
 * `RvfBackend` instance satisfies this structurally with no cast.
 */
export interface IMemoryRvfBackend {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  store(entry: MemoryEntryShape): Promise<void>;
  bulkInsert(entries: readonly MemoryEntryShape[]): Promise<void>;
  search(embedding: Float32Array, options: MemorySearchOptionsShape): Promise<readonly MemorySearchResultShape[]>;
  delete(id: string): Promise<boolean>;
  getStats(): Promise<MemoryBackendStatsShape>;
  getStoredDimension(): Promise<number>;
}

// ─── Adapter config + errors ───

export interface MemoryRvfAdapterConfig {
  /**
   * Vector dimension hint reported in `VectorStats` when the underlying
   * memory backend's `getStoredDimension()` returns 0 (empty store). Should
   * match the `dimensions` the memory `RvfBackend` was constructed with.
   */
  readonly dimension: number;
  /**
   * Distance metric reported in `VectorStats.metric`. Memory's `getStats()`
   * does not surface the metric, so the adapter takes it as config. Defaults
   * to `'cosine'` — matches the memory `RvfBackend`'s default.
   */
  readonly metric?: 'cosine' | 'l2' | 'ip';
  /**
   * Namespace assigned to `MemoryEntry` records the adapter mints when
   * `insertAsync` / `insertBatchAsync` callers do not supply one in metadata.
   * Defaults to `'agentdb-vector'` so memory-listing tooling can distinguish
   * adapter-minted entries from cli-direct memory writes.
   */
  readonly defaultNamespace?: string;
}

/**
 * Thrown when a `VectorBackend` sync method is called on this adapter. The
 * `@claude-flow/memory` `RvfBackend` is async-only; silently buffering would
 * violate `feedback-no-fallbacks` (sync writes would appear to succeed but
 * never reach the HNSW index until an unrelated flush).
 */
export class MemoryRvfAdapterSyncUnsupportedError extends Error {
  constructor(method: string) {
    super(
      `MemoryRvfAdapter.${method}() called via the sync VectorBackend API. ` +
        `The memory RvfBackend is async-only — use ${method}Async() (or the ` +
        `VectorBackendAsync interface) instead.`,
    );
    this.name = 'MemoryRvfAdapterSyncUnsupportedError';
  }
}

/**
 * Thrown by `searchAsync` when the caller supplies `SearchOptions.filter`.
 * Memory's `IMemoryBackend.search` accepts a narrowly-typed `MemoryQuery`
 * predicate (namespace/tags/memoryType/...), not the agentdb
 * `Record<string, unknown>` post-filter shape. There is no honest structural
 * translation that does not re-interpret caller intent — silently dropping
 * the filter would violate `feedback-no-fallbacks`. Callers needing
 * post-filtering must do it at the substrate-read layer that consumes the
 * adapter's results.
 */
export class MemoryRvfAdapterFilterUnsupportedError extends Error {
  constructor(filterKeys: readonly string[]) {
    super(
      `MemoryRvfAdapter.searchAsync received SearchOptions.filter with keys ` +
        `[${filterKeys.join(', ')}]. Memory's IMemoryBackend.search accepts a ` +
        `narrowly-typed MemoryQuery predicate (namespace/tags/memoryType/...), ` +
        `not arbitrary metadata keys. Post-filter at the substrate-read layer ` +
        `that consumes these results, or extend the adapter with an explicit ` +
        `filter-mapping config.`,
    );
    this.name = 'MemoryRvfAdapterFilterUnsupportedError';
  }
}

// ─── Adapter ───

const DEFAULT_NAMESPACE = 'agentdb-vector';
const DEFAULT_METRIC: 'cosine' | 'l2' | 'ip' = 'cosine';

export class MemoryRvfAdapter implements VectorBackendAsync {
  readonly name = 'rvf' as const;

  private readonly memory: IMemoryRvfBackend;
  private readonly dimensionHint: number;
  private readonly metric: 'cosine' | 'l2' | 'ip';
  private readonly defaultNamespace: string;

  constructor(memory: IMemoryRvfBackend, config: MemoryRvfAdapterConfig) {
    this.memory = memory;
    this.dimensionHint = config.dimension;
    this.metric = config.metric ?? DEFAULT_METRIC;
    this.defaultNamespace = config.defaultNamespace ?? DEFAULT_NAMESPACE;
  }

  // ─── VectorBackendAsync (async methods) ───

  async insertAsync(
    id: string,
    embedding: Float32Array,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const entry = this.buildEntry(id, embedding, metadata);
    await this.memory.store(entry);
  }

  async insertBatchAsync(
    items: Array<{ id: string; embedding: Float32Array; metadata?: Record<string, unknown> }>,
  ): Promise<void> {
    const entries: MemoryEntryShape[] = items.map((item) =>
      this.buildEntry(item.id, item.embedding, item.metadata),
    );
    await this.memory.bulkInsert(entries);
  }

  async searchAsync(
    query: Float32Array,
    k: number,
    options?: AgentdbSearchOptions,
  ): Promise<AgentdbSearchResult[]> {
    // DA-2: `options.filter` (arbitrary `Record<string, unknown>` post-filter
    // — agentdb's `SearchOptions.filter`) is NOT silently dropped. Memory's
    // own `SearchOptions.filters` is a narrowly-typed `MemoryQuery` predicate
    // (namespace / tags / memoryType / accessLevel / ownerId / metadata /
    // time-range — see memory `types.d.ts:97-135`), not the
    // `Record<string, unknown>` shape agentdb uses. There is no honest
    // structural translation from arbitrary-keys → `MemoryQuery` here without
    // re-interpreting caller intent (e.g. is `{ tag: 'x' }` a tag filter or a
    // metadata filter?). Per `feedback-no-fallbacks`, fail loud: callers that
    // need post-filtering must either pre-filter at the substrate read layer
    // or extend the adapter with an explicit mapping config.
    if (options?.filter && Object.keys(options.filter).length > 0) {
      throw new MemoryRvfAdapterFilterUnsupportedError(Object.keys(options.filter));
    }
    const memOptions: MemorySearchOptionsShape = {
      k,
      ...(options?.threshold !== undefined ? { threshold: options.threshold } : {}),
    };
    const memResults = await this.memory.search(query, memOptions);

    // Build the agentdb-shape result array from scratch (substrate-semantic).
    return memResults.map((r): AgentdbSearchResult => ({
      id: r.entry.id,
      distance: r.distance,
      similarity: r.score,
      metadata: { ...r.entry.metadata },
    }));
  }

  async removeAsync(id: string): Promise<boolean> {
    return this.memory.delete(id);
  }

  async getStatsAsync(): Promise<VectorStats> {
    const stats = await this.memory.getStats();
    const storedDim = await this.memory.getStoredDimension();
    return {
      count: stats.totalEntries,
      dimension: storedDim > 0 ? storedDim : this.dimensionHint,
      metric: this.metric,
      backend: 'rvf',
      memoryUsage: stats.memoryUsage,
    };
  }

  /**
   * No-op — memory's `RvfBackend` writes eagerly to its WAL on every
   * `store` / `bulkInsert`. There are no buffered sync writes for this
   * adapter to flush (the sync `insert` / `insertBatch` methods throw rather
   * than buffer; see `MemoryRvfAdapterSyncUnsupportedError`).
   */
  async flush(): Promise<void> {
    return;
  }

  // ─── VectorBackendAsync (inherited sync VectorBackend surface) ───

  insert(_id: string, _embedding: Float32Array, _metadata?: Record<string, unknown>): void {
    throw new MemoryRvfAdapterSyncUnsupportedError('insert');
  }

  insertBatch(
    _items: Array<{ id: string; embedding: Float32Array; metadata?: Record<string, unknown> }>,
  ): void {
    throw new MemoryRvfAdapterSyncUnsupportedError('insertBatch');
  }

  search(_query: Float32Array, _k: number, _options?: AgentdbSearchOptions): AgentdbSearchResult[] {
    throw new MemoryRvfAdapterSyncUnsupportedError('search');
  }

  remove(_id: string): boolean {
    throw new MemoryRvfAdapterSyncUnsupportedError('remove');
  }

  /**
   * Sync `getStats()` cannot be served from an async `BackendStats` source
   * without buffering. The async surface (`getStatsAsync`) is the contract;
   * callers reaching for the sync version are wired wrong.
   */
  getStats(): VectorStats {
    throw new MemoryRvfAdapterSyncUnsupportedError('getStats');
  }

  /**
   * No-op — memory's RvfBackend persists eagerly to its `.rvf` + WAL files
   * on every write. There is no separate index file for the adapter to
   * checkpoint; persistence is the memory backend's responsibility and
   * happens without explicit `save()`.
   */
  async save(_path: string): Promise<void> {
    return;
  }

  /**
   * No-op — memory's RvfBackend loads from its `.rvf` + WAL during its own
   * `initialize()`. Loading from an adapter-supplied path would require
   * the memory backend to re-target its storage, which is out of scope for
   * a typed bridge (and not a real use case — callers construct the memory
   * `RvfBackend` with its storage path before handing it to the adapter).
   */
  async load(_path: string): Promise<void> {
    return;
  }

  /**
   * Delegate `close()` to memory's `shutdown()`. The `VectorBackend.close`
   * signature is sync void; memory's `shutdown` is async. Fire-and-forget
   * is unacceptable (`feedback-no-fallbacks` — a swallowed shutdown error
   * is silent data loss), so this method throws to direct callers to the
   * async path. Adapter consumers that want clean shutdown call
   * `memory.shutdown()` directly on the memory backend they own — they
   * own its lifecycle, not the adapter.
   */
  close(): void {
    throw new MemoryRvfAdapterSyncUnsupportedError('close');
  }

  // ─── Internals ───

  private buildEntry(
    id: string,
    embedding: Float32Array,
    metadata?: Record<string, unknown>,
  ): MemoryEntryShape {
    const now = Date.now();
    const namespace = this.resolveNamespace(metadata);
    const key = this.resolveKey(id, metadata);
    return {
      id,
      key,
      content: '',
      embedding,
      type: 'semantic',
      namespace,
      tags: [],
      metadata: metadata ? { ...metadata } : {},
      accessLevel: 'private',
      createdAt: now,
      updatedAt: now,
      version: 1,
      references: [],
      accessCount: 0,
      lastAccessedAt: now,
    };
  }

  private resolveNamespace(metadata: Record<string, unknown> | undefined): string {
    const raw = metadata?.namespace;
    return typeof raw === 'string' && raw.length > 0 ? raw : this.defaultNamespace;
  }

  private resolveKey(id: string, metadata: Record<string, unknown> | undefined): string {
    const raw = metadata?.key;
    return typeof raw === 'string' && raw.length > 0 ? raw : id;
  }
}
