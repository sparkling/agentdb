// charter: substrate-seam
// ADR-0181 Phase 1 + Phase 4 — initialize(config) feeding behavioral spec.
//
// Phase 1 makes each host process (cli, ruflo daemon, hook-handler) construct
// its OWN per-process Archivist and feed it a projectRoot-only
// ArchivistInitConfig. The first describe block is the behavioral spec for that
// config: it asserts a projectRoot-only init is (a) REAL — FS-JSON substrates
// resolve and thread through the supplied projectRoot — and (b) HONEST — RVF /
// SQLite carve-out substrates fail loud rather than silently no-op, because
// Phase 1 deliberately wires no rvfBackend / sqliteDb (deferred to the phase
// that un-stubs the handlers dispatching through them).
//
// "init-completion, not registry non-emptiness" is the ADR-0181 Phase 1
// exit-gate invariant: initialize() eagerly builds only the substrate families
// whose backend the config supplies — FS-JSON is lazy-minted on demand — so a
// projectRoot-only config legitimately leaves the eager registry empty. What
// must hold is that initialize() COMPLETES and the lazy FS-JSON path works.
//
// The second describe block (Phase 4) is the substrate-wiring gate: with a real
// rvfBackend (the W1 MemoryRvfAdapter wrapping an IMemoryRvfBackend) + a fresh
// better-sqlite3.Database + the three capability factories, the RVF and SQLite
// carve-out routes that Phase 1 fails-loud on MUST now resolve, the registry
// MUST become non-empty (substrates are lazily minted into the registry Map on
// first getSubstrate), and the dispatch path MUST thread the resolved narrow
// capability handles onto every MutationContext / ReadContext.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import {
  Archivist,
  registerReadHandler,
  registerMutationHandler,
  type ArchivistInitConfig,
  type EmbeddingScorer,
  type MutationContext,
  type PatternReader,
  type ReadContext,
  type StoreId,
  type TaskRouter,
} from '../../src/archivist/index.js';
import {
  MemoryRvfAdapter,
  type IMemoryRvfBackend,
  type MemoryBackendStatsShape,
  type MemoryEntryShape,
  type MemorySearchOptionsShape,
  type MemorySearchResultShape,
} from '../../src/adapters/memory-rvf-adapter.js';

function freshProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'adr0181-p1-'));
  // FS-JSON substrates live under <projectRoot>/.claude-flow/ — make it exist
  // so substrate construction never races a missing parent.
  mkdirSync(join(root, '.claude-flow'), { recursive: true });
  return root;
}

describe('ADR-0181 Phase 1 — Archivist.initialize() projectRoot-only config feeding', () => {
  it('initialize({ projectRoot }) completes and is idempotent', async () => {
    const projectRoot = freshProjectRoot();
    const archivist = new Archivist();

    await expect(archivist.initialize({ projectRoot })).resolves.toBeUndefined();
    // Idempotent — `if (this.initialized) return` — a second call is a no-op.
    await expect(archivist.initialize({ projectRoot })).resolves.toBeUndefined();
  });

  it('an FS-JSON store resolves through the supplied projectRoot (config is REAL)', async () => {
    const projectRoot = freshProjectRoot();
    const archivist = new Archivist();
    await archivist.initialize({ projectRoot });

    // `tasks` is in neither the RVF nor the SQLite-carve-out roster → it
    // classifies as fs-json → lazily minted from projectRoot. A projectRoot-only
    // config MUST make this resolve, not throw.
    const substrate = archivist.getSubstrate('tasks' as StoreId);
    expect(substrate).toBeDefined();
  });

  it('an RVF store fails loud — projectRoot-only wires no rvfBackend (config is HONEST)', async () => {
    const projectRoot = freshProjectRoot();
    const archivist = new Archivist();
    await archivist.initialize({ projectRoot });

    // `memory_store` classifies as rvf. Phase 1's projectRoot-only config
    // supplies no rvfBackend, so getSubstrate() MUST throw — never return a
    // silent no-op substrate (feedback-no-fallbacks).
    expect(() => archivist.getSubstrate('memory_store' as StoreId)).toThrow(/rvfBackend/i);
  });

  it('a SQLite carve-out store fails loud — projectRoot-only wires no sqliteDb', async () => {
    const projectRoot = freshProjectRoot();
    const archivist = new Archivist();
    await archivist.initialize({ projectRoot });

    // `agentdb_causal_recall` classifies as the SQLite carve-out (ADR-0166).
    // projectRoot-only supplies no sqliteDb → getSubstrate() MUST throw.
    expect(() => archivist.getSubstrate('agentdb_causal_recall' as StoreId)).toThrow(/sqliteDb/i);
  });
});

// ── Phase 4 substrate-wiring gate ─────────────────────────────────────────────
//
// V1 of ADR-0181 Phase 4: with the W1 `MemoryRvfAdapter` supplied as the
// `rvfBackend`, a fresh `better-sqlite3` handle supplied as `sqliteDb`, and the
// three capability factories supplied, initialize() must close the Phase-1
// fail-loud gaps. Concretely:
//
//   - getSubstrate('memory_store')          stops throwing — RVF route lives.
//   - getSubstrate('agentdb_causal_recall') stops throwing — SQLite carve-out lives.
//   - The lazy registry becomes non-empty after the first resolve of each.
//   - A no-op mutation/read dispatch threads ctx.capabilities.taskRouter,
//     .embeddingScorer, and .patternReader onto the context — fail-loud
//     `require*` accessors return the factory-resolved narrow handle.
//
// The adapter is exercised STRUCTURALLY: the V1 gate is about *substrate
// routing*, not vector math correctness. A minimal in-memory IMemoryRvfBackend
// honors the structural shape so MemoryRvfAdapter can be constructed and
// passed in as a real VectorBackendAsync — no cast-lie. V3/V4/V5 own the
// per-handler tests that drive the adapter's vector path.

/**
 * Minimal in-memory IMemoryRvfBackend honoring the structural shape the
 * adapter requires. Just enough to be constructible and pass through
 * `Archivist.initialize()` — never actually queried by the V1 substrate-route
 * assertions (those only resolve the substrate; vector ops are V3/V4 scope).
 */
function makeStubMemoryBackend(): IMemoryRvfBackend {
  const entries = new Map<string, MemoryEntryShape>();
  return {
    async initialize(): Promise<void> {},
    async shutdown(): Promise<void> {
      entries.clear();
    },
    async store(entry: MemoryEntryShape): Promise<void> {
      entries.set(entry.id, entry);
    },
    async bulkInsert(items: readonly MemoryEntryShape[]): Promise<void> {
      for (const e of items) entries.set(e.id, e);
    },
    async search(
      _embedding: Float32Array,
      _options: MemorySearchOptionsShape,
    ): Promise<readonly MemorySearchResultShape[]> {
      return [];
    },
    async delete(id: string): Promise<boolean> {
      return entries.delete(id);
    },
    async getStats(): Promise<MemoryBackendStatsShape> {
      return { totalEntries: entries.size, memoryUsage: 0 };
    },
    async getStoredDimension(): Promise<number> {
      return 0;
    },
    async getByKey(): Promise<MemoryEntryShape | null> {
      return null;
    },
    async update(): Promise<MemoryEntryShape | null> {
      return null;
    },
    async query(): Promise<readonly MemoryEntryShape[]> {
      return [];
    },
    async listNamespaces(): Promise<readonly string[]> {
      return [];
    },
  };
}

/** Capture-and-throw `TaskRouter` stub — never invoked by V1 assertions. */
function makeStubTaskRouter(): TaskRouter {
  return {
    async route(): Promise<never> {
      throw new Error('test-stub TaskRouter: route() was not expected during V1');
    },
  };
}

/** Capture-and-throw `EmbeddingScorer` stub — never invoked by V1 assertions. */
function makeStubEmbeddingScorer(): EmbeddingScorer {
  return {
    async embed(): Promise<never> {
      throw new Error('test-stub EmbeddingScorer: embed() was not expected during V1');
    },
    cosineSimilarity(): number {
      throw new Error('test-stub EmbeddingScorer: cosineSimilarity() was not expected during V1');
    },
  };
}

/** Capture-and-throw `PatternReader` stub — never invoked by V1 assertions. */
function makeStubPatternReader(): PatternReader {
  return {
    async searchPatterns(): Promise<never> {
      throw new Error('test-stub PatternReader: searchPatterns() was not expected during V1');
    },
  };
}

/**
 * Build the Phase-4 fully-wired ArchivistInitConfig. Caller passes in the
 * projectRoot; this helper resolves the rest. Each capability factory is
 * invoked at most once by `Archivist.initialize()`, so the factory closures'
 * `last*` captures hold whatever was returned on that single call.
 */
function buildFullyWiredConfig(projectRoot: string): {
  readonly config: ArchivistInitConfig;
  readonly resolvedTaskRouter: TaskRouter;
  readonly resolvedEmbeddingScorer: EmbeddingScorer;
  readonly resolvedPatternReader: PatternReader;
  readonly sqliteDb: BetterSqlite3.Database;
} {
  const memBackend = makeStubMemoryBackend();
  const adapter = new MemoryRvfAdapter(memBackend, { dimension: 384 });
  const sqliteDb = new BetterSqlite3(':memory:');
  const taskRouter = makeStubTaskRouter();
  const embeddingScorer = makeStubEmbeddingScorer();
  const patternReader = makeStubPatternReader();
  return {
    config: {
      projectRoot,
      rvfBackend: adapter,
      sqliteDb,
      taskRouterFactory: () => taskRouter,
      embeddingScorerFactory: () => embeddingScorer,
      patternReaderFactory: () => patternReader,
    },
    resolvedTaskRouter: taskRouter,
    resolvedEmbeddingScorer: embeddingScorer,
    resolvedPatternReader: patternReader,
    sqliteDb,
  };
}

// Per-test handler names — registration.ts's module-global registry rejects
// duplicates, so each test gets a unique suffix to coexist with sibling tests.
let testHandlerCounter = 0;
function uniqueHandlerName(prefix: string): string {
  testHandlerCounter += 1;
  return `${prefix}_${process.pid}_${testHandlerCounter}`;
}

describe('ADR-0181 Phase 4 — Archivist.initialize() fully-wired substrate registry', () => {
  it('initialize({ rvfBackend, sqliteDb, taskRouterFactory, embeddingScorerFactory, patternReaderFactory }) completes', async () => {
    const projectRoot = freshProjectRoot();
    const { config } = buildFullyWiredConfig(projectRoot);
    const archivist = new Archivist();

    await expect(archivist.initialize(config)).resolves.toBeUndefined();
    // Idempotent — second call is a no-op.
    await expect(archivist.initialize(config)).resolves.toBeUndefined();
  });

  it('getSubstrate("memory_store") resolves the RVF substrate (Phase-1 throw is closed)', async () => {
    const projectRoot = freshProjectRoot();
    const { config } = buildFullyWiredConfig(projectRoot);
    const archivist = new Archivist();
    await archivist.initialize(config);

    // Phase 1 throws here with /rvfBackend/i because no backend is wired.
    // Phase 4: the adapter wrapper is wired, so the throw is closed.
    const substrate = archivist.getSubstrate('memory_store' as StoreId);
    expect(substrate).toBeDefined();
  });

  it('getSubstrate("agentdb_causal_recall") resolves the SQLite carve-out substrate (Phase-1 throw is closed)', async () => {
    const projectRoot = freshProjectRoot();
    const { config } = buildFullyWiredConfig(projectRoot);
    const archivist = new Archivist();
    await archivist.initialize(config);

    // Phase 1 throws here with /sqliteDb/i because no handle is wired.
    // Phase 4: the in-memory better-sqlite3 handle is wired, so the throw is closed.
    const substrate = archivist.getSubstrate('agentdb_causal_recall' as StoreId);
    expect(substrate).toBeDefined();
  });

  it('the substrate registry is non-empty after first resolves of an RVF + SQLite store', async () => {
    const projectRoot = freshProjectRoot();
    const { config } = buildFullyWiredConfig(projectRoot);
    const archivist = new Archivist();
    await archivist.initialize(config);

    // Substrates are lazily minted into the registry's Map on first resolve
    // (substrate-registry.ts SubstrateRegistry.resolve). The registry is
    // private, so we observe it through the public surface: two resolves of
    // distinct family substrates MUST both succeed (no throw) and a third
    // resolve of an FS-JSON storeId MUST also succeed and mint a per-path
    // substrate. Three distinct substrates witnessed via the registry.
    const rvf = archivist.getSubstrate('memory_store' as StoreId);
    const sqlite = archivist.getSubstrate('agentdb_causal_recall' as StoreId);
    const fsJson = archivist.getSubstrate('tasks' as StoreId);

    expect(rvf).toBeDefined();
    expect(sqlite).toBeDefined();
    expect(fsJson).toBeDefined();
    // RVF + SQLite carve-out share one instance each across their roster, so
    // a second resolve of a SIBLING RVF storeId MUST return the same handle.
    const rvfSibling = archivist.getSubstrate('agentdb_pattern_store' as StoreId);
    expect(rvfSibling).toBe(rvf);
  });

  it('a read dispatch threads embeddingScorer + patternReader onto ctx.capabilities', async () => {
    const projectRoot = freshProjectRoot();
    const { config, resolvedEmbeddingScorer, resolvedPatternReader } =
      buildFullyWiredConfig(projectRoot);
    const archivist = new Archivist();
    await archivist.initialize(config);

    let captured: ReadContext | undefined;
    const toolName = uniqueHandlerName('v1_read');
    registerReadHandler<undefined, undefined>(
      toolName,
      async (ctx): Promise<undefined> => {
        captured = ctx;
        return undefined;
      },
    );

    await archivist.dispatchRead(toolName, undefined);

    expect(captured).toBeDefined();
    expect(captured!.capabilities.embeddingScorer).toBe(resolvedEmbeddingScorer);
    expect(captured!.capabilities.patternReader).toBe(resolvedPatternReader);
    // requireEmbeddingScorer / requirePatternReader MUST return the same handle
    // (no fallback throw — capability IS wired).
    expect(captured!.capabilities.requireEmbeddingScorer()).toBe(resolvedEmbeddingScorer);
    expect(captured!.capabilities.requirePatternReader()).toBe(resolvedPatternReader);
    expect(captured!.projectRoot).toBe(projectRoot);
  });

  it('a mutation dispatch threads taskRouter + embeddingScorer onto ctx.capabilities', async () => {
    const projectRoot = freshProjectRoot();
    const { config, resolvedTaskRouter, resolvedEmbeddingScorer } =
      buildFullyWiredConfig(projectRoot);
    const archivist = new Archivist();
    await archivist.initialize(config);

    let captured: MutationContext<false> | undefined;
    const toolName = uniqueHandlerName('v1_mut');
    registerMutationHandler<undefined>(
      toolName,
      async (ctx, _payload): Promise<void> => {
        captured = ctx;
      },
    );

    await archivist.dispatch(toolName, undefined);

    expect(captured).toBeDefined();
    expect(captured!.capabilities.taskRouter).toBe(resolvedTaskRouter);
    expect(captured!.capabilities.embeddingScorer).toBe(resolvedEmbeddingScorer);
    expect(captured!.capabilities.requireTaskRouter()).toBe(resolvedTaskRouter);
    expect(captured!.capabilities.requireEmbeddingScorer()).toBe(resolvedEmbeddingScorer);
    expect(captured!.projectRoot).toBe(projectRoot);
  });

  it('the MemoryRvfAdapter satisfies VectorBackendAsync structurally (no cast at the interface)', () => {
    // Compile-time + runtime spot check: the adapter `implements
    // VectorBackendAsync` directly per the adapter source. If a future
    // edit drops the `implements` clause or adds a cast at the boundary,
    // ArchivistInitConfig.rvfBackend (typed RvfBackend, structurally
    // VectorBackendAsync) would still accept it — but the brand-honest
    // signature is the gate. This assertion documents the gate: every
    // method the interface requires MUST exist on the adapter instance.
    const adapter = new MemoryRvfAdapter(makeStubMemoryBackend(), { dimension: 384 });
    expect(adapter.name).toBe('rvf');
    expect(typeof adapter.insertAsync).toBe('function');
    expect(typeof adapter.insertBatchAsync).toBe('function');
    expect(typeof adapter.searchAsync).toBe('function');
    expect(typeof adapter.removeAsync).toBe('function');
    expect(typeof adapter.getStatsAsync).toBe('function');
    expect(typeof adapter.flush).toBe('function');
    // Sync surface MUST throw, not buffer (feedback-no-fallbacks).
    expect(() => adapter.insert('x', new Float32Array(384))).toThrow(/sync/i);
    expect(() => adapter.getStats()).toThrow(/sync/i);
  });
});
