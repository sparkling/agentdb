// charter: testing-surface
// Public testing entrypoint — production code cannot reach this module under
// the main tsconfig.json (path-restricted per ADR-0180 Follow-up #20). Test
// files (*.test.ts, *.spec.ts) compile under tsconfig.test.json which adds
// this directory to module resolution.
//
// Surface (per ADR-0180 lines ~771-797):
//   withTestContext<T>(handler, payload, opts?)          — cold-path or hot-path execution
//   withTestReadContext<T, R>(handler, payload, opts?)   — read-handler execution
//   makeFsJsonSubstrateFixture(opts)                     — re-exported FS-JSON fixture
//
// The branded MutationContextLike/SubstrateAccess types deliberately have no
// public constructor at runtime. This file IS the test-only minter; production
// code cannot import from `@pkg/archivist/testing` because the path is excluded
// from the main tsconfig. The brands themselves use the same machinery as the
// production runtime — refactors that weaken the brand break this file too.

import type { AuditEntry } from '../audit-types.js';
import type {
  BulkIntent,
  GuardedRead,
  GuardedWrite,
  MutationContextLike,
  ReadContextLike,
  StoreId,
  SubstrateAccess,
  SubstrateHandle,
} from '../types.js';
import type { GuardVerdict } from '../guards-types.js';
import {
  makeMutationCapabilities,
  makeReadCapabilities,
  type EmbeddingScorer,
  type PatternReader,
  type TaskRouter,
} from '../capabilities.js';
import { type AuditNode, treeDepth } from './audit-tree.js';
import {
  type FsJsonSubstrateFixture,
  type LockWait,
  makeFsJsonSubstrateFixture,
} from './fs-json-substrate-fixture.js';

export { makeFsJsonSubstrateFixture };
export type { FsJsonSubstrateFixture, LockWait, AuditNode };
export { treeDepth, flattenTree, unorderedEqualForParallel } from './audit-tree.js';

// ---------------------------------------------------------------------------
// Bulk-manifest view — one entry per ctx.bulk() / substrate.withBulkWrite call.

export interface BulkManifest {
  readonly intent: BulkIntent;
  readonly count: number;
  readonly checksum: string;
  readonly tableList: ReadonlyArray<string>;
  /** Audit-entry id the manifest is referenced from (manifestRef target). */
  readonly auditId: string;
}

// ---------------------------------------------------------------------------
// Hot-path view — present iff opts.hotPath: true. Surfaces the ring buffer +
// post-write trigger queue per ADR-0180 §Performance.

export interface HotPathPostWriteTrigger {
  /** Marker for which trigger fired (`bm25-reindex`, `cache-warmup`, ...). */
  readonly name: string;
  /** ms after enqueue when the trigger ran (resolved via setImmediate). */
  readonly ranAt: number;
}

export interface HotPathTestView {
  /** Always false on hot path — guards are bypassed by registration contract. */
  readonly guardsInvoked: false;
  /** Audit entries routed via the ring buffer (NOT the flat `audit` array). */
  readonly ringBuffer: AuditEntry[];
  /** Post-write triggers wrapped in setImmediate, captured in order. */
  readonly postWriteTriggers: HotPathPostWriteTrigger[];
}

// ---------------------------------------------------------------------------
// Result envelopes. Conditional types compile-time forbid:
//   - bulk × hotPath: bulkManifests is `never[]` when hotPath: true
//   - child × hotPath: ctx.child / ctx.bulk typed `never` via MutationContextLike<true>

export type TestResult<T, HotPath extends boolean = false> = {
  readonly audit: AuditEntry[];
  readonly auditTree: AuditNode;
  readonly bulkManifests: HotPath extends true ? never[] : BulkManifest[];
  readonly substrate: Map<string, unknown>;
  readonly hotPath: HotPath extends true ? HotPathTestView : undefined;
  /** Echo back the payload that was passed in — convenience for assertions. */
  readonly payload: T;
};

export interface ReadTestResult<T, R> {
  readonly result: R;
  readonly payload: T;
  /** Cache hints the handler emitted via ReadContext.cacheHints. */
  readonly cacheHints: { readonly wrote_cache: boolean; readonly cache_keys: string[] };
}

// ---------------------------------------------------------------------------
// Options. `WithTestContextOpts<HotPath>` flows the HotPath bit into TestResult.

export type GuardPolicy = 'permissive' | 'production' | ReadonlyArray<GuardVerdict>;

export interface WithTestContextOpts<HotPath extends boolean = false> {
  /** Run handler under hot-path contract (guards skipped, ring buffer, async triggers). */
  readonly hotPath?: HotPath;
  /** Substrate override — default is an in-memory Map<string, unknown>-backed fake. */
  readonly substrate?: SubstrateAccess;
  /**
   * Guard policy:
   *   - 'permissive' (default): no verdicts, all writes proceed.
   *   - 'production': run the registered default guards (size, quality, pii, schema, rate-limit).
   *     Currently no-op pending production guards module (Phase 4); equivalent to permissive.
   *   - GuardVerdict[]: pre-supplied verdicts; an `outcome: 'veto'` rejects the mutation
   *     and the audit entry is written with state: 'rejected'.
   */
  readonly guards?: GuardPolicy;
  /** Override the originatingTool field in audit entries. Default 'test'. */
  readonly originatingTool?: string;
  /**
   * Override `ctx.projectRoot` (ADR-0180 F4-2 Phase C). Default `process.cwd()` —
   * matches `Archivist.initialize()`'s default. Tests for handlers that resolve
   * project-relative paths (`handlers/hooks/session-end.ts`) pass an explicit
   * root here.
   */
  readonly projectRoot?: string;
  /**
   * Narrow capability handles for `ctx.capabilities` (ADR-0180 F4-2 Phase C).
   * Each is OPTIONAL — omitted capabilities leave the bundle's `require*`
   * accessor fail-loud, exactly as production does for an unwired factory. A
   * handler test that exercises `ctx.capabilities.taskRouter` / `embeddingScorer`
   * supplies a stub here.
   */
  readonly taskRouter?: TaskRouter;
  readonly embeddingScorer?: EmbeddingScorer;
}

export interface WithTestReadContextOpts {
  readonly substrate?: SubstrateAccess;
  readonly originatingTool?: string;
  readonly intent?: string;
  /** Override `ctx.projectRoot` (ADR-0180 F4-2 Phase C). Default `process.cwd()`. */
  readonly projectRoot?: string;
  /**
   * Narrow capability handles for `ctx.capabilities` (ADR-0180 F4-2 Phase C).
   * Read-side bundle: `embeddingScorer` (query re-embed) + `patternReader`
   * (SQLite carve-out fusion read). Omitted capabilities fail loud at the
   * `require*` accessor, as production does.
   */
  readonly embeddingScorer?: EmbeddingScorer;
  readonly patternReader?: PatternReader;
}

// ---------------------------------------------------------------------------
// In-memory substrate fake — the default when opts.substrate is omitted.
//
// `Map<string, unknown>` keyed by store name. Each store's value is itself a
// Map<string, unknown> of key → payload. vectorSearch returns insertion order
// with score 1.0 — handler logic only, no semantic ranking (integration tests
// cover ranking).

interface InMemoryFakeState {
  readonly storeData: Map<string, Map<string, unknown>>;
  readonly insertOrder: Map<string, string[]>;
}

function makeInMemoryFake(): { access: SubstrateAccess; state: InMemoryFakeState } {
  const storeData = new Map<string, Map<string, unknown>>();
  const insertOrder = new Map<string, string[]>();

  const ensureStore = (id: string): Map<string, unknown> => {
    let m = storeData.get(id);
    if (!m) {
      m = new Map<string, unknown>();
      storeData.set(id, m);
      insertOrder.set(id, []);
    }
    return m;
  };

  const handle: SubstrateHandle = {
    async read<R>(scope: { storeId: StoreId; key: string }): Promise<R | undefined> {
      return storeData.get(scope.storeId as string)?.get(scope.key) as R | undefined;
    },
    async write<T>(scope: { storeId: StoreId; key: string; payload: T }): Promise<void> {
      const m = ensureStore(scope.storeId as string);
      if (!m.has(scope.key)) insertOrder.get(scope.storeId as string)!.push(scope.key);
      m.set(scope.key, scope.payload);
    },
    async withWrite<T>(
      scope: { storeId: StoreId },
      fn: (h: SubstrateHandle) => Promise<T>,
    ): Promise<T> {
      ensureStore(scope.storeId as string);
      return fn(handle);
    },
    async withBulkWrite(
      _intent: BulkIntent,
      fn: (h: SubstrateHandle) => Promise<void>,
    ): Promise<void> {
      await fn(handle);
    },
  };
  // Optional read-side helpers used by some handlers; not on the canonical
  // SubstrateHandle but exposed via the brand for test convenience.
  const enriched = handle as SubstrateHandle & {
    query<R>(scope: { storeId: StoreId; predicate: unknown }): Promise<ReadonlyArray<R>>;
    vectorSearch<R>(scope: {
      storeId: StoreId;
      vector: Float32Array;
      topK: number;
    }): Promise<ReadonlyArray<{ item: R; score: number }>>;
  };
  enriched.query = async <R>(scope: { storeId: StoreId; predicate: unknown }) => {
    void scope.predicate;
    const keys = insertOrder.get(scope.storeId as string) ?? [];
    const m = storeData.get(scope.storeId as string);
    return keys.map((k) => m!.get(k) as R);
  };
  enriched.vectorSearch = async <R>(scope: {
    storeId: StoreId;
    vector: Float32Array;
    topK: number;
  }) => {
    void scope.vector;
    const keys = insertOrder.get(scope.storeId as string) ?? [];
    const m = storeData.get(scope.storeId as string);
    const limited = keys.slice(0, scope.topK);
    return limited.map((k) => ({ item: m!.get(k) as R, score: 1.0 }));
  };

  const access = handle as unknown as SubstrateAccess;
  return { access, state: { storeData, insertOrder } };
}

// ---------------------------------------------------------------------------
// AuditEntry / AuditNode construction — test seam only. Production runtime
// owns the canonical audit-entry constructor; this minimal shape is sufficient
// for handler unit tests.

let auditCounter = 0;
function nextAuditId(): string {
  return `test-audit-${(++auditCounter).toString(36)}`;
}

function makeAuditEntry(
  originatingTool: string,
  parentAuditId: string | undefined,
  guardVerdicts: ReadonlyArray<GuardVerdict>,
  state: 'applied' | 'rejected',
): AuditEntry {
  return {
    auditId: nextAuditId(),
    originatingTool,
    processId: { pid: process.pid, role: 'cli', sessionId: 'test' },
    parentAuditId,
    timestamp: Date.now(),
    payloadHash: '',
    state,
    guardVerdicts,
    contextVersion: 1,
  };
}

// ---------------------------------------------------------------------------
// Substrate snapshot for the `substrate` field in TestResult. Always exposed
// as Map<string, unknown> (per ADR contract). For FS-JSON fixtures we expose
// the same `files` Map; for the in-memory fake we flatten each store's keyed
// state into the same shape.

function snapshotSubstrate(substrate: SubstrateAccess, state?: InMemoryFakeState): Map<string, unknown> {
  // FS-JSON fixture exposes a `files: Map<string, unknown>` brand-augment.
  const maybeFsJson = substrate as unknown as Partial<FsJsonSubstrateFixture>;
  if (maybeFsJson.files instanceof Map) {
    return new Map(maybeFsJson.files);
  }
  if (state) {
    const out = new Map<string, unknown>();
    for (const [storeId, m] of state.storeData) {
      out.set(storeId, new Map(m));
    }
    return out;
  }
  return new Map();
}

// ---------------------------------------------------------------------------
// Context construction. The branded MutationContext is built by composing
// the (test-provided) substrate with audit/guard machinery; the handler sees
// the same MutationContextLike interface production code does.
//
// Re-entrancy: ctx.child(reason) returns a fresh context whose audit entry's
// parentAuditId points at the caller's auditId, and whose AuditNode is pushed
// onto the parent's children array.

interface CapturedState {
  readonly audit: AuditEntry[];
  readonly bulkManifests: BulkManifest[];
  readonly ringBuffer: AuditEntry[];
  readonly postWriteTriggers: HotPathPostWriteTrigger[];
  readonly tree: AuditNode;
  readonly originatingTool: string;
  readonly verdicts: ReadonlyArray<GuardVerdict>;
  readonly hotPath: boolean;
  /** Resolved project root threaded onto every context (incl. `ctx.child()`). */
  readonly projectRoot: string;
  /** Narrow capability bundle threaded onto every context (incl. `ctx.child()`). */
  readonly capabilities: ReturnType<typeof makeMutationCapabilities>;
}

function makeCapturedState(
  originatingTool: string,
  hotPath: boolean,
  guards: GuardPolicy,
  projectRoot: string,
  capabilities: ReturnType<typeof makeMutationCapabilities>,
): CapturedState {
  const audit: AuditEntry[] = [];
  const bulkManifests: BulkManifest[] = [];
  const ringBuffer: AuditEntry[] = [];
  const postWriteTriggers: HotPathPostWriteTrigger[] = [];

  const verdicts: ReadonlyArray<GuardVerdict> =
    guards === 'permissive' || guards === 'production' || guards === undefined ? [] : guards;

  const rootEntry = makeAuditEntry(originatingTool, undefined, verdicts, 'applied');
  if (hotPath) ringBuffer.push(rootEntry);
  else audit.push(rootEntry);

  const tree: AuditNode = {
    entry: rootEntry,
    children: [],
    mode: 'sequential',
  };

  return {
    audit,
    bulkManifests,
    ringBuffer,
    postWriteTriggers,
    tree,
    originatingTool,
    verdicts,
    hotPath,
    projectRoot,
    capabilities,
  };
}

function buildContext<HotPath extends boolean>(
  parentNode: AuditNode,
  captured: CapturedState,
  substrate: SubstrateAccess,
  hotPath: HotPath,
): MutationContextLike<HotPath> {
  type ChildField = HotPath extends true ? never : (reason: string) => MutationContextLike<false>;
  type BulkField = HotPath extends true
    ? never
    : (intent: BulkIntent, payload: unknown) => Promise<void>;

  const child: HotPath extends true ? undefined : (reason: string) => MutationContextLike<false> =
    (hotPath
      ? undefined
      : (reason: string): MutationContextLike<false> => {
          void reason;
          const childEntry = makeAuditEntry(
            captured.originatingTool,
            parentNode.entry.auditId,
            captured.verdicts,
            'applied',
          );
          captured.audit.push(childEntry);
          const childNode: AuditNode = {
            entry: childEntry,
            children: [],
            mode: 'sequential',
          };
          parentNode.children.push(childNode);
          return buildContext(childNode, captured, substrate, false);
        }) as any;

  const bulk: HotPath extends true ? undefined : BulkField = (hotPath
    ? undefined
    : (async (intent: BulkIntent, payload: unknown) => {
        void payload;
        const bulkEntry = makeAuditEntry(
          captured.originatingTool,
          parentNode.entry.auditId,
          captured.verdicts,
          'applied',
        );
        captured.audit.push(bulkEntry);
        const manifest: BulkManifest = {
          intent,
          count: intent.count,
          checksum: intent.checksum,
          tableList: [intent.tableName],
          auditId: bulkEntry.auditId,
        };
        captured.bulkManifests.push(manifest);
        const bulkNode: AuditNode = {
          entry: bulkEntry,
          children: [],
          mode: 'sequential',
        };
        parentNode.children.push(bulkNode);
      })) as any;

  const ctx: MutationContextLike<HotPath> = {
    auditId: parentNode.entry.auditId,
    originatingTool: captured.originatingTool,
    guardVerdicts: captured.verdicts,
    timestamp: parentNode.entry.timestamp,
    substrate,
    projectRoot: captured.projectRoot,
    capabilities: captured.capabilities,
    child: child as ChildField,
    bulk: bulk as BulkField,
  };
  return ctx;
}

// ---------------------------------------------------------------------------
// withTestContext — public entrypoint for GuardedWrite<T> handler tests.

export async function withTestContext<T, HotPath extends boolean = false>(
  handler: GuardedWrite<T>,
  payload: T,
  opts?: WithTestContextOpts<HotPath>,
): Promise<TestResult<T, HotPath>> {
  const hotPath = (opts?.hotPath ?? false) as HotPath;
  const guards = opts?.guards ?? 'permissive';
  const originatingTool = opts?.originatingTool ?? 'test';
  // ADR-0180 F4-2 Phase C: resolve the context's project root + narrow
  // capability bundle. Default root matches `Archivist.initialize()`. The
  // bundle wraps whatever capability stubs the test supplied; omitted ones stay
  // fail-loud at the `require*` accessor, exactly as production behaves for an
  // unwired `ArchivistInitConfig` factory.
  const projectRoot = opts?.projectRoot ?? process.cwd();
  const capabilities = makeMutationCapabilities({
    taskRouter: opts?.taskRouter,
    embeddingScorer: opts?.embeddingScorer,
  });

  // Pre-check pre-supplied verdicts for veto — short-circuits before handler runs.
  if (Array.isArray(guards)) {
    const veto = guards.find((v) => v.outcome === 'veto');
    if (veto) {
      const rejectedEntry = makeAuditEntry(originatingTool, undefined, guards, 'rejected');
      const result = {
        audit: [rejectedEntry],
        auditTree: { entry: rejectedEntry, children: [], mode: 'sequential' as const },
        bulkManifests: (hotPath ? [] : []) as HotPath extends true ? never[] : BulkManifest[],
        substrate: new Map<string, unknown>(),
        hotPath: (hotPath ? undefined : undefined) as HotPath extends true
          ? HotPathTestView
          : undefined,
        payload,
      };
      return result as TestResult<T, HotPath>;
    }
  }

  let substrate = opts?.substrate;
  let fakeState: InMemoryFakeState | undefined;
  if (!substrate) {
    const fake = makeInMemoryFake();
    substrate = fake.access;
    fakeState = fake.state;
  }

  const captured = makeCapturedState(originatingTool, hotPath, guards, projectRoot, capabilities);
  const ctx = buildContext(captured.tree, captured, substrate, hotPath);

  // Hot-path payload >4KB diverts to cold path per ADR-0180 #20 line ~786.
  let diverted = false;
  if (hotPath) {
    const byteLength = Buffer.byteLength(JSON.stringify(payload ?? null), 'utf8');
    if (byteLength > 4096) {
      diverted = true;
      // Move the root entry from ringBuffer back to audit; treat as cold.
      const idx = captured.ringBuffer.indexOf(captured.tree.entry);
      if (idx >= 0) captured.ringBuffer.splice(idx, 1);
      const cold = { ...captured.tree.entry } as AuditEntry & {
        divertedFromHotPath?: boolean;
      };
      cold.divertedFromHotPath = true;
      captured.audit.push(cold as AuditEntry);
    }
  }

  await (handler as unknown as (c: typeof ctx, p: T) => Promise<void>)(ctx, payload);

  // Post-write trigger demo — handlers don't currently emit triggers via
  // MutationContext; this is reserved scaffolding for Phase 7 hot-path tests.
  if (hotPath && !diverted) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  const hotPathView: HotPathTestView | undefined = hotPath
    ? {
        guardsInvoked: false,
        ringBuffer: captured.ringBuffer,
        postWriteTriggers: captured.postWriteTriggers,
      }
    : undefined;

  return {
    audit: captured.audit,
    auditTree: captured.tree,
    bulkManifests: (hotPath ? [] : captured.bulkManifests) as HotPath extends true
      ? never[]
      : BulkManifest[],
    substrate: snapshotSubstrate(substrate, fakeState),
    hotPath: hotPathView as HotPath extends true ? HotPathTestView : undefined,
    payload,
  };
}

// ---------------------------------------------------------------------------
// withTestReadContext — public entrypoint for GuardedRead<T, R> handler tests.

export async function withTestReadContext<T, R>(
  handler: GuardedRead<T, R>,
  payload: T,
  opts?: WithTestReadContextOpts,
): Promise<ReadTestResult<T, R>> {
  const substrateOverride = opts?.substrate;
  let substrate = substrateOverride;
  if (!substrate) {
    substrate = makeInMemoryFake().access;
  }
  // ReadContextLike doesn't expose substrate at the type level — handlers
  // access it via the runtime ReadContext, which the test seam shadows here.
  const cacheStore = new Map<string, unknown>();
  const wroteKeys: string[] = [];
  // ADR-0180 F4-2 Phase C: project root + narrow read-capability bundle. Default
  // root matches `Archivist.initialize()`; omitted capability stubs stay
  // fail-loud at the `require*` accessor as production does.
  const ctx: ReadContextLike & { substrate: SubstrateAccess } = {
    originatingTool: opts?.originatingTool ?? 'test',
    requestId: `test-req-${(++auditCounter).toString(36)}`,
    intent: opts?.intent,
    cacheHints: {
      wrote_cache: false,
      cache_keys: wroteKeys,
    },
    cache: {
      get<RR>(key: string): RR | undefined {
        return cacheStore.get(key) as RR | undefined;
      },
    },
    substrate,
    projectRoot: opts?.projectRoot ?? process.cwd(),
    capabilities: makeReadCapabilities({
      embeddingScorer: opts?.embeddingScorer,
      patternReader: opts?.patternReader,
    }),
  };

  const result = await (handler as unknown as (c: typeof ctx, p: T) => Promise<R>)(ctx, payload);

  return {
    result,
    payload,
    cacheHints: {
      wrote_cache: ctx.cacheHints?.wrote_cache ?? false,
      cache_keys: wroteKeys,
    },
  };
}
