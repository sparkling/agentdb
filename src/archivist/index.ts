// charter: dispatch
// Public surface of the archivist (ADR-0180). This file is the ONLY supported
// import entry point for consumers — store code imports `Archivist`, the public
// type aliases, and the registration HOFs from here.
//
// Public dispatch entry points (per ADR-0180 §Type enforcement, §Audit chain):
//   - `Archivist.dispatch(toolName, payload)` — mutations. Mints `MutationContext`,
//     composes guards, opens/closes audit entry, evaluates invariants, invokes the
//     registered mutation handler. This is what cli MCP tools / CLI commands /
//     hooks / inter-controller writes call.
//   - `Archivist.dispatchRead(toolName, payload)` — reads. Mints `ReadContext`,
//     invokes the registered read handler. No guards, no audit (per §Audit chain:
//     reads are passthroughs).
//
// Deliberately NOT re-exported (per §Type enforcement):
//   - `makeSubstrateAccess` / `makeReadOnlySubstrateAccess` (substrate-internal.ts)
//   - `createMutationContext` / `createReadContext` (mutation-context.ts, read-context.ts)
//   - `dispatchMutation` / `dispatchRead` / `getRegistration` / `__resetRegistry__`
//     (registration.ts internals — the public `Archivist.dispatch` / `dispatchRead`
//     instance methods are the only callable surface)
//
// The MODULE.md charter enumerates the archivist's responsibilities. The
// `scripts/check-archivist-charter.sh` gate asserts every file under
// `src/archivist/**` carries a `// charter: <tag>` header whose tag is listed in
// MODULE.md (ADR-0180 §Governance).

import { composeGuards, registerGuard, type GuardFn } from './guards';
import type { GuardVerdict } from './guards-types';
import { createMutationContext } from './mutation-context';
import { createReadContext } from './read-context';
import {
  makeMutationCapabilities,
  makeReadCapabilities,
  type EmbeddingScorer,
  type PatternReader,
  type TaskRouter,
} from './capabilities';
import {
  getRegistration,
  registerMutationHandler,
  registerReadHandler,
  type Invariant,
  type RegisterMutationOpts,
  type RegisterReadOpts,
} from './registration';
import type { MutationHandlerFn, HotPathMutationHandlerFn, ReadHandlerFn } from './registration';
import type { AuditEntry, AuditState, InvariantVerdict } from './audit-types';
import { writeThroughEntry } from './audit-writer';
import { getSharedHotPathQueue } from './hot-path-writer';
import { makeReadOnlySubstrateAccess, makeSubstrateAccess } from './substrate-internal';
import { makeFsJsonSubstrate } from './substrates/fs-json-store';
import { makeRvfSubstrate } from './substrates/rvf-store';
import { makeSqliteSubstrate } from './substrates/sqlite-store';
import {
  SubstrateRegistry,
  fsJsonPathFor,
  type SubstrateFamily,
} from './substrate-registry';
import type { RvfBackend } from '../backends/rvf/RvfBackend';
import type BetterSqlite3 from 'better-sqlite3';
import type {
  GuardedRead,
  GuardedWrite,
  ReadCapableSubstrate,
  ReadOnlySubstrateHandle,
  StoreId,
  SubstrateAccess,
  SubstrateHandle,
} from './types';
import { createHash, randomUUID } from 'node:crypto';

// --- Re-exported public types ---
export type {
  Brand,
  BulkIntent,
  GuardedRead,
  GuardedWrite,
  Namespace,
  ReadOnlySubstrateAccess,
  StoreId,
  SubstrateAccess,
  SubstrateHandle,
  ReadOnlySubstrateHandle,
} from './types';
export type {
  ChildMode,
  HotPathMutationContext,
  MutationContext,
} from './mutation-context';
export type {
  CacheHints,
  ReadContext,
  ReadOnlyCache,
} from './read-context';
// Narrow capability handles threaded onto the contexts (ADR-0180 F4-2 Phase C).
// Handlers import these to type the `ctx.capabilities.*` surfaces; the raw
// controllers (`SemanticRouter`, `EmbeddingService`, `ReasoningBank`) are NOT
// re-exported — the type-enforcement boundary lets a handler see only the narrow
// capability, never the backend object (see `capabilities.ts`).
export type {
  EmbeddingScorer,
  MutationCapabilities,
  PatternHit,
  PatternReader,
  ReadCapabilities,
  RouteDecision,
  TaskRouter,
} from './capabilities';
export type {
  GuardName,
  GuardOutcome,
  GuardVerdict,
  PiiVerdict,
  PluginVerdict,
  QualityVerdict,
  RateLimitVerdict,
  SchemaVerdict,
  SizeVerdict,
} from './guards';
export type {
  CacheScope,
  HotPathMutationHandlerFn,
  Invariant,
  MutationHandlerFn,
  ReadHandlerFn,
  RegisterMutationOpts,
  RegisterReadOpts,
} from './registration';

// --- Public registration HOFs ---
export { registerMutationHandler, registerReadHandler } from './registration';

// --- Multi-file atomic-write primitive (ADR-0180 OF#11, F4-2 Phase C) ---
// Unlike `makeSubstrateAccess` (deliberately NOT re-exported — it is the
// brand-mint seam stores must not reach), `writeMultiFileAtomic` IS a
// handler-facing primitive: the `daemon_runConsolidate` and
// `daemon_autoMemoryBridge` handlers (F4-2 Phase D) consume it to commit their
// N-file OF#11 artifact sets as one intent — three JSON files for
// consolidation, `MEMORY.md` + per-topic markdown for AutoMemoryBridge. The
// single-document `makeFsJsonSubstrate` cannot express this (`withWrite`
// rewrites ONE file), and those callers have no single `StoreId` → one-file
// route, so the primitive takes N explicit `{ path, payload }` targets directly
// rather than routing through the `StoreId` seam. Atomicity is honest-partial —
// see the primitive's doc-block in `substrates/fs-json-store.ts`.
export { writeMultiFileAtomic } from './substrates/fs-json-store';
export type { MultiFileTarget, MultiFileWriteResult } from './substrates/fs-json-store';

/**
 * Construction-time wiring for `Archivist.initialize()` (ADR-0180 §Architecture
 * · Init). The archivist does not *own* the substrate backends — it receives
 * them. F4-2 Phase B / cli integration is the wiring point that supplies real
 * instances; until then `initialize()` runs with whatever subset is present and
 * the registry fails loud (`feedback-no-fallbacks`) only when a *dispatched*
 * store needs a backend that was not supplied.
 *
 * All fields optional + lazy: an open `better-sqlite3` handle / `RvfBackend`
 * may not be trivially available at the call site, so a *factory* form is also
 * accepted. The factory is invoked at most once, on first `initialize()`.
 *
 * F4-2 Phase C adds the *capability* factories (`taskRouterFactory` /
 * `embeddingScorerFactory` / `patternReaderFactory`) — the construction-time
 * dependencies the handler `TODO(F4-2-config)` gaps name that are NOT substrate
 * backends. Each is supplied as a lazy factory adapting the real controller
 * down to the narrow surface in `capabilities.ts`; the archivist threads the
 * resolved *narrow* handle onto the contexts, never the raw controller (ADR-0180
 * §Type enforcement — same boundary the substrate brand protects).
 */
export interface ArchivistInitConfig {
  /** Open `better-sqlite3` database for the 5 PERMANENT_SQLITE_CARVE_OUT controllers (ADR-0166). */
  readonly sqliteDb?: BetterSqlite3.Database;
  /** Lazy form of `sqliteDb` — resolved once if `sqliteDb` is absent. */
  readonly sqliteDbFactory?: () => BetterSqlite3.Database;
  /** RVF backend for vector + content stores (ADR-0177 RVF-primary). */
  readonly rvfBackend?: RvfBackend;
  /** Lazy form of `rvfBackend` — resolved once if `rvfBackend` is absent. */
  readonly rvfBackendFactory?: () => RvfBackend;
  /**
   * Project root for FS-JSON store paths (`<projectRoot>/.claude-flow/<store>.json`).
   * Defaults to `process.cwd()` — the cli integration wiring point should pass the
   * resolved project root explicitly so daemon/CLI/hook processes agree.
   *
   * F4-2 Phase C: this value is now threaded onto every `MutationContext` /
   * `ReadContext` as `ctx.projectRoot`, not just consumed for substrate paths —
   * `handlers/hooks/session-end.ts` needs it to resolve the daemon socket. That
   * handler's `TODO(F4-2-config)` is fully closed by this.
   */
  readonly projectRoot?: string;
  /**
   * Lazy `TaskRouter` capability factory (ADR-0180 F4-2 Phase C). Adapts the
   * cli's `routeTask(...)` path (SemanticRouter `.route()` + LearningSystem
   * fallback + B7 BanditLearner) down to the narrow `TaskRouter` surface.
   * Threaded onto `MutationContext.capabilities.taskRouter` — closes
   * `handlers/agentdb/route.ts` `TODO(F4-2-config) #1` *if* the cli process can
   * construct the router and pass this factory at the `initialize(config)` call
   * site; otherwise that gap re-tags `TODO(F4-3-callsite)` (see route.ts).
   */
  readonly taskRouterFactory?: () => TaskRouter;
  /**
   * Lazy `EmbeddingScorer` capability factory (ADR-0180 F4-2 Phase C). Adapts
   * `controllers/EmbeddingService` (`embed(text) → Float32Array`) down to the
   * narrow `EmbeddingScorer` surface (`embed` + `cosineSimilarity`). Threaded
   * onto BOTH `MutationContext.capabilities.embeddingScorer` (route.ts
   * `TODO(F4-2-config) #2` — vectorize the task for the RVF write) and
   * `ReadContext.capabilities.embeddingScorer` (reflexion-retrieve.ts +
   * skill-search.ts `TODO(F4-2-config)` — re-embed the query for fresh-similarity
   * ranking).
   */
  readonly embeddingScorerFactory?: () => EmbeddingScorer;
  /**
   * Lazy `PatternReader` capability factory (ADR-0180 F4-2 Phase C). Adapts the
   * ReasoningBank `reasoning_patterns`-table BM25+semantic+RRF fusion read down
   * to the narrow read-only `PatternReader` surface. Threaded onto
   * `ReadContext.capabilities.patternReader` — closes
   * `handlers/agentdb/pattern-search.ts` `TODO(F4-2-config)` *if* the cli process
   * can construct the ReasoningBank read path and pass this factory; otherwise
   * that gap re-tags `TODO(F4-3-callsite)` (see pattern-search.ts).
   */
  readonly patternReaderFactory?: () => PatternReader;
}

/**
 * Public archivist surface. `dispatch()` is live (audit chain + guards +
 * invariants composed). `initialize(config)` builds the substrate registry — the
 * `Map<StoreId, SubstrateAccess>` keystone — from the supplied backends. Handlers
 * receive contexts via the registered HOFs; they cannot mint contexts or reach
 * `SubstrateAccess` outside this dispatch boundary (ADR-0180 §Type enforcement).
 */
export class Archivist {
  private initialized = false;

  /**
   * The substrate registry (ADR-0180 §Architecture · Substrate). Built by
   * `initialize()`; consulted by the dispatch path via `getSubstrate()`. RVF +
   * SQLite carve-out families are pre-registered with shared backend instances;
   * FS-JSON stores are lazily minted per-path on first `getSubstrate()` and
   * cached here (charter `lazy-init` — idle stores never open a file).
   */
  private readonly substrates = new SubstrateRegistry<SubstrateAccess>();

  /**
   * Shared RVF substrate — every RVF-family store routes through this one
   * `RvfBackend` (the backend itself is the multi-store container). `undefined`
   * until `initialize(config)` supplies `rvfBackend` / `rvfBackendFactory`.
   */
  private rvfSubstrate?: SubstrateAccess;

  /**
   * Shared SQLite-carve-out substrate — the 5 PERMANENT_SQLITE_CARVE_OUT
   * controllers (ADR-0166) share one `better-sqlite3` handle. `undefined` until
   * `initialize(config)` supplies `sqliteDb` / `sqliteDbFactory`.
   */
  private sqliteSubstrate?: SubstrateAccess;

  /** Resolved FS-JSON project root — `config.projectRoot ?? process.cwd()`. */
  private projectRoot = process.cwd();

  /**
   * Resolved narrow capability handles (ADR-0180 F4-2 Phase C). Each is the
   * *narrow* surface from `capabilities.ts`, NOT the raw controller — the
   * factory in `ArchivistInitConfig` does the adapt-down. `undefined` until
   * `initialize(config)` invokes the corresponding factory; a handler reaching
   * for an unwired capability fails loud at the `require*` accessor on the
   * bundle (`makeMutationCapabilities` / `makeReadCapabilities`).
   */
  private taskRouter?: TaskRouter;
  private embeddingScorer?: EmbeddingScorer;
  private patternReader?: PatternReader;

  /**
   * Idempotent (the `initialized` guard is load-bearing — dispatch calls this on
   * every invocation). Builds the substrate registry from `config`:
   *
   *   - RVF family → one `makeRvfSubstrate(backend)` shared across every
   *     RVF-family store (ADR-0177 RVF-primary; the backend is the multi-store
   *     container).
   *   - SQLite carve-out → one `makeSqliteSubstrate(db)` shared across the 5
   *     PERMANENT_SQLITE_CARVE_OUT controllers (ADR-0166).
   *   - FS-JSON (~17-store Phase 5 group) → NOT built here. Each store owns a
   *     distinct `.claude-flow/<store>.json` path + lock, so they are minted
   *     lazily per-path on first `getSubstrate()` (charter `lazy-init`).
   *
   * Backends are optional + lazy (`ArchivistInitConfig`): `initialize()` wires
   * whatever subset is present. A *dispatched* store whose family has no backend
   * fails loud in `getSubstrate()` — never a silent placeholder
   * (`feedback-no-fallbacks`). This replaces the per-store `requireAgentDB()` /
   * `RvfNotInitializedError` "fail loud" pattern (ADR-0180 §Init, Phase 10).
   *
   * Replaces the prior 3-line stub. Must complete before any registered handler
   * is invoked.
   */
  async initialize(config: ArchivistInitConfig = {}): Promise<void> {
    if (this.initialized) return;

    this.projectRoot = config.projectRoot ?? process.cwd();

    // RVF family: one shared SubstrateAccess over the RvfBackend (the backend is
    // itself the multi-store container — RVF-family storeIds do not each get a
    // distinct backend). Wired only if a backend (or factory) was supplied.
    const rvfBackend = config.rvfBackend ?? config.rvfBackendFactory?.();
    if (rvfBackend) {
      this.rvfSubstrate = makeRvfSubstrate(rvfBackend);
    }

    // SQLite carve-out: one shared SubstrateAccess over the better-sqlite3 handle
    // — the 5 PERMANENT_SQLITE_CARVE_OUT controllers (ADR-0166) all run on the
    // one database. Wired only if a db (or factory) was supplied.
    const sqliteDb = config.sqliteDb ?? config.sqliteDbFactory?.();
    if (sqliteDb) {
      this.sqliteSubstrate = makeSqliteSubstrate(sqliteDb);
    }

    // Narrow capability handles (ADR-0180 F4-2 Phase C): each factory is invoked
    // at most once here, only if supplied — `initialize()` never force-builds an
    // embedding pipeline or opens the router. The factory returns the *narrow*
    // surface (it owns the adapt-down from the real controller); the resolved
    // handle is stashed and threaded onto the per-dispatch context bundle. An
    // unsupplied factory leaves the holder `undefined` — the dispatch-side
    // `require*` accessor fails loud if a handler needs it (`feedback-no-fallbacks`).
    this.taskRouter = config.taskRouterFactory?.();
    this.embeddingScorer = config.embeddingScorerFactory?.();
    this.patternReader = config.patternReaderFactory?.();

    // FS-JSON stores are intentionally NOT pre-built — see `getSubstrate()`'s
    // lazy `mintLazy` closure. The `if (this.initialized) return` guard above
    // makes the whole method idempotent.
    this.initialized = true;
  }

  /**
   * Resolve a `StoreId` to its `SubstrateAccess` (ADR-0180 §Architecture ·
   * Substrate). The dispatch path calls this to obtain the substrate the
   * `MutationContext` / `ReadContext` carries to the registered handler.
   *
   * Routing (per `substrate-registry.ts` `classifyStore`):
   *   - RVF-family storeId    → the shared `rvfSubstrate`.
   *   - SQLite carve-out      → the shared `sqliteSubstrate`.
   *   - FS-JSON (everything else) → a per-path substrate over
   *     `<projectRoot>/.claude-flow/<store>.json`, minted on first call and
   *     cached in the registry Map.
   *
   * Fail-loud (`feedback-no-fallbacks` / `feedback-data-loss-zero-tolerance`):
   * if the resolved family's backend was not supplied to `initialize(config)`,
   * this throws — it NEVER returns a silent no-op substrate. A handler that
   * needs a backend the process did not wire fails at dispatch, loudly.
   *
   * `initialize()` must have run — `dispatch()`/`dispatchRead()` await it first,
   * so by the time a handler reaches substrate the registry is built.
   */
  getSubstrate(storeId: StoreId): SubstrateAccess {
    return this.substrates.resolve(storeId, (family: SubstrateFamily, id: StoreId): SubstrateAccess => {
      if (family === 'rvf') {
        if (!this.rvfSubstrate) {
          throw new Error(
            `archivist: store '${id}' resolves to the RVF substrate, but no RvfBackend was supplied to initialize() — ` +
            `pass { rvfBackend } (or { rvfBackendFactory }) in ArchivistInitConfig`,
          );
        }
        return this.rvfSubstrate;
      }
      if (family === 'sqlite') {
        if (!this.sqliteSubstrate) {
          throw new Error(
            `archivist: store '${id}' resolves to the SQLite carve-out substrate (ADR-0166), but no better-sqlite3 ` +
            `Database was supplied to initialize() — pass { sqliteDb } (or { sqliteDbFactory }) in ArchivistInitConfig`,
          );
        }
        return this.sqliteSubstrate;
      }
      // fs-json: per-path substrate, lazily minted + cached by the registry.
      // Each FS-JSON store owns a distinct `.claude-flow/<store>.json` file with
      // its own O_EXCL lock — they cannot share one SubstrateAccess.
      return makeFsJsonSubstrate({ path: fsJsonPathFor(this.projectRoot, id) });
    });
  }

  /**
   * The routing `SubstrateAccess` handed to every `MutationContext` (ADR-0180
   * §Architecture · Substrate). The dispatch path has only a `toolName`, not a
   * `StoreId` — and a handler self-declares its `STORE_ID` and may touch several
   * (`handlers/tasks/assign.ts` writes both `tasks` and `hive-mind_agents`). So
   * `ctx.substrate` cannot be a single pre-resolved backend: each `read` /
   * `write` / `withWrite` / `withBulkWrite` call carries its own `storeId` in
   * the scope, and this router resolves it through `getSubstrate()` per call.
   *
   * `getSubstrate()` is the fail-loud point (`feedback-no-fallbacks`): an
   * unclassifiable family or a family whose backend was not supplied to
   * `initialize(config)` throws there — the router never substitutes a no-op.
   * For `withBulkWrite` the storeId is `intent.tableName` (the substrate
   * factories' own convention — see `makeRvfSubstrate` / `makeSqliteSubstrate`).
   */
  private routingSubstrate(): SubstrateHandle {
    const resolve = (storeId: StoreId): SubstrateHandle => this.getSubstrate(storeId);
    return {
      read: (scope) => resolve(scope.storeId).read(scope),
      write: (scope) => resolve(scope.storeId).write(scope),
      withWrite: (scope, fn) => resolve(scope.storeId).withWrite(scope, fn),
      withBulkWrite: (intent, fn) =>
        resolve(intent.tableName as StoreId).withBulkWrite(intent, fn),
    };
  }

  /**
   * The routing `ReadOnlySubstrateAccess` handed to every `ReadContext`.
   *
   * All three operations (`read` / `query` / `vectorSearch`) resolve their
   * `scope.storeId` per-call through `getSubstrate()`, exactly like the
   * mutation router. `getSubstrate()` returns the branded `SubstrateAccess`
   * (write-side); the three substrate factories actually return
   * `ReadCapableSubstrate` at runtime — `SubstrateHandle` PLUS `query` /
   * `vectorSearch` — and the `SubstrateAccess` brand is type-level only
   * (`substrate-internal.ts`: "brand attachment is type-level only; runtime is
   * the raw handle"). So this router narrows the resolved handle back to
   * `ReadCapableSubstrate` to reach the read-only surface.
   *
   * Fail-loud (`feedback-no-fallbacks`) lives in two places, not here:
   *   - `getSubstrate()` throws for a genuinely-unregistered store or a family
   *     whose backend was not supplied to `initialize(config)`.
   *   - The substrate factory throws for an operation it cannot honor — fs-json
   *     `vectorSearch` (no vector index), sqlite `vectorSearch` (relational
   *     carve-out, ADR-0166), rvf `query` (vector-addressed only). Those are
   *     misroute errors: a read handler reaching for the wrong operation on its
   *     store's family fails at dispatch, loudly, rather than silently
   *     degrading. This router does NOT pre-empt them — it forwards every call
   *     so the substrate's own documented throw is the signal.
   */
  private routingReadOnlySubstrate(): ReadOnlySubstrateHandle {
    const resolve = (storeId: StoreId): ReadCapableSubstrate =>
      this.getSubstrate(storeId) as unknown as ReadCapableSubstrate;
    return {
      read: (scope) => resolve(scope.storeId).read(scope),
      query: (scope) => resolve(scope.storeId).query(scope),
      vectorSearch: (scope) => resolve(scope.storeId).vectorSearch(scope),
    };
  }

  /** Pass-through to module-level registration. Class method for ergonomic chaining. */
  registerMutationHandler<T>(
    name: string,
    handler: HotPathMutationHandlerFn<T>,
    opts: RegisterMutationOpts<T> & { hotPath: true },
  ): GuardedWrite<T>;
  registerMutationHandler<T>(
    name: string,
    handler: MutationHandlerFn<T>,
    opts?: RegisterMutationOpts<T>,
  ): GuardedWrite<T>;
  registerMutationHandler<T>(
    name: string,
    handler: MutationHandlerFn<T> | HotPathMutationHandlerFn<T>,
    opts?: RegisterMutationOpts<T>,
  ): GuardedWrite<T> {
    return registerMutationHandler<T>(
      name,
      handler as MutationHandlerFn<T>,
      opts as RegisterMutationOpts<T>,
    );
  }

  registerReadHandler<T, R>(
    name: string,
    handler: ReadHandlerFn<T, R>,
    opts?: RegisterReadOpts,
  ): GuardedRead<T, R> {
    return registerReadHandler<T, R>(name, handler, opts);
  }

  registerGuard(name: string, fn: GuardFn): void {
    registerGuard(name, fn);
  }

  /**
   * Public mutation-dispatch entry point (ADR-0180 §Architecture · Type enforcement,
   * §Audit chain). MCP tool handlers, CLI commands, hooks, and inter-controller
   * writes call here:
   *
   *   await archivist.dispatch('hive-mind_spawn', payload);
   *
   * Flow: composes guards → opens audit `intent` entry → mints `MutationContext`
   * → invokes handler → evaluates invariants → finalizes audit (`applied` |
   * `rejected` | `failed`). Veto verdicts and invariant violations abort the
   * write per `feedback-data-loss-zero-tolerance` (no silent fall-through).
   *
   * Reads go through `dispatchRead` — calling `dispatch` with a read-registered
   * tool throws (the discriminated registry lookup enforces channel separation,
   * matching the §Audit chain rule that reads carry no audit ceremony).
   *
   * Substrate seam: `ctx.substrate` is the routing `SubstrateAccess` from
   * `routingSubstrate()` — each `read` / `write` / `withWrite` call resolves its
   * `scope.storeId` through `getSubstrate()` to the real RVF / SQLite / FS-JSON
   * backend wired by `initialize(config)`. A storeId whose family has no backend
   * fails loud in `getSubstrate()` — never a silent no-op (`feedback-no-fallbacks`).
   */
  async dispatch(toolName: string, payload: unknown): Promise<unknown> {
    await this.initialize();
    const lookup = getRegistration(toolName);
    if (!lookup) {
      throw new Error(`archivist: no handler registered for tool '${toolName}'`);
    }
    if (lookup.kind !== 'mutation') {
      throw new Error(
        `archivist: dispatch '${toolName}' targets a read handler — call archivist.dispatchRead() instead`,
      );
    }
    return await this.dispatchMutationInternal(
      toolName,
      payload,
      lookup.entry.handler,
      lookup.entry.invariants,
      lookup.entry.hotPath,
    );
  }

  /**
   * Public read-dispatch entry point (ADR-0180 §Architecture · Audit chain — reads
   * are passthroughs; no guards, no audit). Mints `ReadContext`, invokes the
   * registered read handler, returns the result.
   *
   *   const result = await archivist.dispatchRead('hive-mind_status', payload);
   *
   * Mutations go through `dispatch` — calling `dispatchRead` with a mutation-
   * registered tool throws (channel separation matches the registry's
   * discriminated lookup).
   *
   * Substrate seam: `ctx.substrate` is the routing `ReadOnlySubstrateAccess`
   * from `routingReadOnlySubstrate()`. `read` / `query` / `vectorSearch` each
   * resolve their `scope.storeId` per-call through `getSubstrate()` to the real
   * RVF / SQLite / FS-JSON backend wired by `initialize(config)`. A substrate
   * throws for an operation its family cannot honor (fs-json/sqlite
   * `vectorSearch`, rvf `query`) — a documented misroute error, not a silent
   * no-op (`feedback-no-fallbacks`).
   */
  async dispatchRead(toolName: string, payload: unknown): Promise<unknown> {
    await this.initialize();
    const lookup = getRegistration(toolName);
    if (!lookup) {
      throw new Error(`archivist: no handler registered for tool '${toolName}'`);
    }
    if (lookup.kind !== 'read') {
      throw new Error(
        `archivist: dispatchRead '${toolName}' targets a mutation handler — call archivist.dispatch() instead`,
      );
    }
    return await this.dispatchReadInternal(toolName, payload, lookup.entry.handler);
  }

  private async dispatchMutationInternal(
    toolName: string,
    payload: unknown,
    handler: MutationHandlerFn<unknown> | HotPathMutationHandlerFn<unknown>,
    invariants: ReadonlyArray<Invariant<unknown>>,
    hotPath: boolean,
  ): Promise<void> {
    const auditId = randomUUID();
    const timestamp = Date.now();
    const payloadHash = hashPayload(payload);

    // Audit sink (ADR-0180 §Performance): hot-path handlers route entries through
    // the in-flight queue (drains on microtask, never blocks the leaf write);
    // cold-path mutations write-through synchronously — full ceremony, latency
    // is not budgeted. The sink is bound per-dispatch so the hotPath bit from the
    // registry decides the path without threading it through every call site.
    const writeAudit = makeAuditSink(hotPath);

    const composed = await composeGuards({ tool: toolName }, payload, {
      originatingTool: toolName,
      timestamp,
    });

    const baseEntry = {
      auditId,
      originatingTool: toolName,
      processId: currentProcessId(),
      timestamp,
      payloadHash,
      guardVerdicts: composed.verdicts,
      contextVersion: 1,
    } as const;

    // Audit `intent` entry opens BEFORE the substrate write (handler invocation
    // below) — ADR-0180 §Audit chain. A crash between intent and finalize leaves
    // a dangling `intent` row that replay treats as `failed`.
    await writeAudit({ ...baseEntry, state: 'intent' });

    if (composed.outcome === 'veto') {
      await writeAudit({ ...baseEntry, state: 'rejected' });
      throw new Error(
        `archivist: dispatch '${toolName}' rejected by guards: ${vetoReasons(composed.verdicts)}`,
      );
    }

    const ctx = createMutationContext({
      auditId,
      originatingTool: toolName,
      guardVerdicts: composed.verdicts,
      timestamp,
      substrate: makeSubstrateAccess(this.routingSubstrate()),
      // ADR-0180 F4-2 Phase C: thread the resolved project root + the narrow
      // capability bundle onto the context. `projectRoot` is the same value the
      // substrate layer uses for FS-JSON paths. `makeMutationCapabilities` wraps
      // the resolved (factory-invoked) narrow handles with fail-loud `require*`
      // accessors — a handler never sees the raw controller.
      projectRoot: this.projectRoot,
      capabilities: makeMutationCapabilities({
        taskRouter: this.taskRouter,
        embeddingScorer: this.embeddingScorer,
      }),
      bulkDispatch: async () => {
        throw new Error('archivist: bulk dispatch not yet wired (Phase 4 substrate seam)');
      },
      mintChildAuditId: () => randomUUID(),
    });

    try {
      await (handler as MutationHandlerFn<unknown>)(ctx, payload);
    } catch (err) {
      await writeAudit({ ...baseEntry, state: 'failed' });
      throw err;
    }

    const invariantVerdicts: InvariantVerdict[] = invariants.map((inv) => {
      const verdict = inv({
        callerIntent: payload,
        recordedPayload: payload,
        substrateStateBefore: undefined,
        substrateStateAfter: undefined,
      });
      return { name: inv.name || 'anonymous', verdict };
    });

    const violation = invariantVerdicts.find(
      (v) => typeof v.verdict === 'object' && (v.verdict as { violated: true }).violated === true,
    );
    if (violation) {
      await writeAudit({ ...baseEntry, state: 'rejected', invariantVerdicts });
      const detail = (violation.verdict as { detail: string }).detail;
      throw new Error(`archivist: invariant '${violation.name}' violated: ${detail}`);
    }

    await writeAudit({ ...baseEntry, state: 'applied', invariantVerdicts });
  }

  private async dispatchReadInternal(
    toolName: string,
    payload: unknown,
    handler: ReadHandlerFn<unknown, unknown>,
  ): Promise<unknown> {
    const ctx = createReadContext({
      originatingTool: toolName,
      requestId: randomUUID(),
      cache: { get: () => undefined },
      substrate: makeReadOnlySubstrateAccess(this.routingReadOnlySubstrate()),
      // ADR-0180 F4-2 Phase C: same project root + narrow capability bundle as
      // the mutation path. Read-side bundle carries `embeddingScorer` (query
      // re-embed) + `patternReader` (SQLite carve-out fusion read); no
      // `taskRouter` — routing is a MUTATING surface, absent by construction.
      projectRoot: this.projectRoot,
      capabilities: makeReadCapabilities({
        embeddingScorer: this.embeddingScorer,
        patternReader: this.patternReader,
      }),
    });
    return await handler(ctx, payload);
  }
}

function hashPayload(payload: unknown): string {
  const canonical = JSON.stringify(payload ?? null);
  return createHash('sha256').update(canonical).digest('hex');
}

function vetoReasons(verdicts: ReadonlyArray<GuardVerdict>): string {
  return verdicts
    .filter((v) => v.outcome === 'veto')
    .map((v) => `${v.guard}${v.reason ? `: ${v.reason}` : ''}`)
    .join('; ');
}

function currentProcessId(): AuditEntry['processId'] {
  return {
    pid: process.pid,
    role: 'cli',
    sessionId: process.env.RUFLO_SESSION_ID ?? 'unknown',
  };
}

type AuditSinkEntry = Omit<AuditEntry, 'state'> & {
  readonly state: AuditState;
  readonly invariantVerdicts?: ReadonlyArray<InvariantVerdict>;
};

/**
 * Per-dispatch audit sink (ADR-0180 §Performance). `hotPath` mutations enqueue
 * onto the shared `HotPathQueue` — `enqueue` returns synchronously and the queue
 * drains write-through on a microtask, so the leaf write is never blocked on
 * fsync batching. Cold-path mutations await `writeThroughEntry` directly: full
 * journal ceremony, latency not budgeted. Either way the entry lands in
 * `.claude-flow/data/archivist-audit.jsonl` — there is no in-memory-only path.
 */
function makeAuditSink(hotPath: boolean): (entry: AuditSinkEntry) => Promise<void> {
  if (hotPath) {
    const queue = getSharedHotPathQueue();
    return async (entry: AuditSinkEntry): Promise<void> => {
      queue.enqueue(entry);
    };
  }
  return async (entry: AuditSinkEntry): Promise<void> => {
    await writeThroughEntry(entry);
  };
}
