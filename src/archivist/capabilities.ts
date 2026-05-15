// charter: type-enforcement
// Narrow capability handles threaded onto MutationContext / ReadContext (ADR-0180
// F4-2 Phase C).
//
// WHY THIS FILE EXISTS — the type-enforcement boundary:
//   Handlers must NOT receive raw controller / backend objects (`SemanticRouter`,
//   `EmbeddingService`, `ReasoningBank`, an open `better-sqlite3` handle). Doing so
//   would re-open the exact seam ADR-0180 §Type enforcement closes for the
//   substrate: a handler holding a raw backend can call anything on it, bypassing
//   the archivist's audit/guard/invariant ceremony and the substrate-registry
//   routing. The substrate solves this with the branded opaque `SubstrateAccess`
//   over a minimal `SubstrateHandle`; this file does the same for the *other*
//   construction-time dependencies the handler `TODO(F4-2-config)` gaps name.
//
//   Each interface below is a NARROW surface — the smallest set of methods the
//   handler that needs it actually calls, named in that handler's TODO. The
//   `ArchivistInitConfig` wiring point supplies a *factory* that adapts the real
//   controller down to this surface (or, where the controller is constructed in
//   a different process, leaves a documented `TODO(F4-3-callsite)` gap). Handlers
//   reach these via `MutationContext.capabilities` / `ReadContext.capabilities`,
//   never as a raw object.
//
// LAZINESS — every capability is OPTIONAL and resolved through a factory:
//   `initialize(config)` must not force-construct an embedding pipeline or open a
//   router just because it ran. The factory form (`() => Capability`) is invoked
//   at most once, on first `initialize()`, and only if supplied. A handler that
//   dispatches needing a capability the process did not wire fails loud at the
//   capability accessor (`feedback-no-fallbacks`) — never a silent no-op.

/**
 * Task-routing capability — the narrow surface `handlers/agentdb/route.ts`
 * (`TODO(F4-2-config) #1`) needs. Backed at the wiring point by the cli's
 * `routeTask(...)` path (SemanticRouter `.route()` → `LearningSystem
 * .recommendAlgorithm` fallback, plus the B7 BanditLearner arm statistics).
 *
 * The handler hands `{ task, context, namespace }` in and receives the composed
 * decision `{ route, confidence, agents, controller }` — it does NOT get the
 * `SemanticRouter` instance, the bandit, or their per-namespace history maps.
 * The trajectory *persistence* (the RVF vector write) stays the handler's job
 * via `ctx.substrate`; this capability only computes the decision.
 */
export interface TaskRouter {
  /**
   * Compute a routing decision for `task`. `context` is optional free-form
   * provenance the router blends into its lookup; `namespace` scopes the
   * router's history (defaults to `'default'` at the wiring point).
   *
   * MUTATING note: the underlying SemanticRouter / BanditLearner updates arm
   * statistics as a side-effect of routing — that is *why* `agentdb_route` is a
   * `GuardedWrite`. The capability surface returns the decision; the handler is
   * responsible for the audited substrate write that records the trajectory.
   */
  route(input: {
    readonly task: string;
    readonly context?: string;
    readonly namespace?: string;
  }): Promise<RouteDecision>;
}

/** Composed routing decision — mirrors the cli `routeTask(...)` return shape. */
export interface RouteDecision {
  readonly route: string;
  readonly confidence: number;
  readonly agents: ReadonlyArray<string>;
  readonly controller: string;
}

/**
 * Embedding + similarity capability — the narrow surface three handlers name:
 *   - `handlers/agentdb/reflexion-retrieve.ts` (`TODO(F4-2-config)`): re-embed
 *     the query `task` so episodes rank by *fresh* cosine similarity instead of
 *     the similarity captured at write time.
 *   - `handlers/agentdb/route.ts` (`TODO(F4-2-config) #2`): vectorize
 *     `payload.task` for the RVF trajectory record.
 *   - `handlers/agentdb/skill-search.ts` (`TODO(F4-2-config)`): score skills by
 *     embedding cosine similarity instead of the lexical-overlap stand-in.
 *
 * Backed at the wiring point by `controllers/EmbeddingService` (`embed(text) →
 * Float32Array`). `cosineSimilarity` is included because every consumer above
 * pairs `embed` with a similarity comparison — exposing it here keeps the math
 * one well-tested implementation rather than three handler-local copies.
 */
export interface EmbeddingScorer {
  /** Embed `text` to its vector. One model, shared across handlers (ADR-0069). */
  embed(text: string): Promise<Float32Array>;
  /**
   * Cosine similarity of two equal-length vectors, in `[-1, 1]`. Throws on a
   * length mismatch (`feedback-no-fallbacks` — a silent 0 would mask a
   * dimension bug).
   */
  cosineSimilarity(a: Float32Array, b: Float32Array): number;
}

/**
 * ReasoningBank patterns READ capability — the narrow surface
 * `handlers/agentdb/pattern-search.ts` (`TODO(F4-2-config)`) needs. That handler
 * is the one ranked-read whose substrate family is the SQLite carve-out
 * (ADR-0166): the `reasoning_patterns` table is SQL-addressed, and the read-only
 * `ReadContext.substrate` deliberately cannot expose a SQL handle. Rather than
 * leak the raw `better-sqlite3` connection or the whole `ReasoningBank`
 * controller, this capability exposes ONLY the BM25 + semantic + RRF fusion read
 * the handler ports from cli `searchPatterns(...)`.
 *
 * Read-only by construction: there is no `storePattern` here — the per-pattern
 * *write* (`agentdb_pattern_store`) is RVF-family and goes through `ctx.substrate
 * .withWrite` on the mutation side. This asymmetry is the ADR-0166 axis
 * separation; the capability surface enforces it (a read handler physically
 * cannot reach the write path).
 */
export interface PatternReader {
  /**
   * BM25 + semantic fusion search over the ReasoningBank `reasoning_patterns`
   * table. `topK` caps the result set; `minConfidence` post-filters by the
   * fused score. Returns hits already ordered best-first.
   */
  searchPatterns(query: {
    readonly query: string;
    readonly topK?: number;
    readonly minConfidence?: number;
  }): Promise<ReadonlyArray<PatternHit>>;
}

/** A single ReasoningBank pattern hit — mirrors the cli `searchPatterns(...)` hit shape. */
export interface PatternHit {
  readonly id: string;
  readonly content: string;
  readonly score: number;
}

/**
 * GNNService telemetry capability — narrow READ surface for the
 * `agentdb_gnn_stats` handler (`handlers/agentdb/gnn-stats.ts`). Backed at the
 * cli wiring point by an adapter over `getController('gnnService')`. The
 * adapter MUST resolve the controller PER CALL (not cached at module/closure
 * scope) so a controller swap mid-process is observed at the next dispatch —
 * matches the resolution discipline established by the Phase 7 r1 → r2 lesson
 * (cached handles split cli-vs-archivist state).
 *
 * GNNService has no SQLite persistence (compute-only — controller-registry.ts
 * :1707-1717), so this capability surfaces in-process telemetry rather than a
 * substrate read. The `agentdb_neural_patterns` `'similar'` action stays
 * substrate-backed via `ctx.substrate.vectorSearch` against
 * `agentdb_pattern_store`; `'stats'` is split out to its own dispatched handler
 * so neither bypasses dispatch (b5-queen verdict 2026-05-15 — option (a)).
 */
export interface GNNTelemetryReader {
  /**
   * Return GNNService telemetry: engine type (`native` / `js` / `unknown`),
   * initialised flag, count of cached patterns, and optional config snapshot.
   * Implementation reads off `getController('gnnService')` per call.
   */
  getStats(): Promise<{
    readonly engine: string;
    readonly initialized: boolean;
    readonly count: number;
    readonly config?: unknown;
  }>;
}

/**
 * SemanticRouter route-lookup capability — narrow READ surface for the
 * `agentdb_semantic_route` handler (`handlers/agentdb/semantic-route.ts`).
 * Backed at the cli wiring point by an adapter over
 * `getController('semanticRouter').route(input)`. Same per-call resolution
 * discipline as `GNNTelemetryReader` above.
 *
 * SemanticRouter holds routes in an in-memory `Map<string, RouteConfig>` plus
 * an optional `@ruvector/router` native handle. The `agentdb_semantic_add_route`
 * cli tool persists each addition to `.claude-flow/semantic-routes.json`;
 * `controller-registry.ts:1412-1432` re-hydrates the router from that file on
 * construction so subsequent CLI subprocesses see the same routes. The handler
 * reaches this surface BEFORE any substrate `vectorSearch` path — substrate-
 * backed route persistence is future-ADR scope.
 */
export interface SemanticRouteReader {
  /**
   * Route a query to the best-matching named route. Returns `null` when no
   * route matches (legitimate empty result — e.g. fresh router with no
   * `addRoute` calls); otherwise returns `{ route, confidence, metadata? }`
   * mirroring SemanticRouter's `route(input)` shape (services/SemanticRouter.ts).
   *
   * NULL means "router has no matching route". The handler lifts a non-null
   * result into a one-element `RankedResults<SemanticRouteHit>` and returns
   * `[]` on null — matches the cli wrapper's existing empty-array handling at
   * agentdb-tools.ts:778 (`top` undefined → `{success:false, route:null}`).
   */
  route(input: string): Promise<{
    readonly route: string;
    readonly confidence: number;
    readonly metadata?: Record<string, unknown>;
  } | null>;
}

// ── ADR-0181 Phase 6 stub-body wire-up capabilities ──────────────────────────
//
// Each of the writer capabilities below is the narrow surface ONE Phase 6
// handler ports its cli body onto. The contract pattern is uniform:
//   - Method name + payload mirror the cli orchestration helper
//     (`forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-orchestration.ts`).
//   - Return shape carries `{ success, controller, error? }` so the handler can
//     branch on controller-availability (matches ADR-0093 F4 / ADR-0162 Batch E
//     hand-port semantics — when the controller is wired, success carries the
//     primary table write; when it returns `null` / `success:false`, the handler
//     falls back to substrate.withWrite RVF persistence).
//   - Return `null` from the capability call (vs an envelope with
//     `success:false`) means "controller not present in this process" —
//     handlers MUST treat null as the fallback trigger. An envelope with
//     `success:false` + `error` means the controller ran and refused the
//     write; handlers MUST surface that as a throw (ADR-0082 no-silent-failure).
//
// Each capability is OPTIONAL per the laziness rationale at the top of this
// file; a handler that dispatches needing an unwired writer fails loud at the
// `require*` accessor on the `MutationCapabilities` bundle.

/**
 * Narrow surface for the ReasoningBank pattern-store path —
 * `handlers/agentdb/pattern-store.ts` (Phase 6 wire-up). Backed at the cli
 * wiring point by `storePattern(...)` (`agentdb-orchestration.ts:16`) which
 * routes through `routePatternOp({ type: 'store', ... })` — primary persistence
 * in the `reasoning_patterns` SQLite table when the ReasoningBank controller is
 * wired, fallthrough to memory_store RVF when it is not.
 */
export interface ReasoningBankWriter {
  storePattern(input: {
    readonly pattern: string;
    readonly type: string;
    readonly confidence: number;
  }): Promise<ReasoningBankWriteResult | null>;
}

export interface ReasoningBankWriteResult {
  readonly success: boolean;
  readonly patternId: string;
  readonly controller: string;
  readonly error?: string;
}

/**
 * Narrow surface for the SkillLibrary creation path —
 * `handlers/agentdb/skill-create.ts` (Phase 6 wire-up). Backed at the cli
 * wiring point by an adapter over `agentdb-tools.ts` `agentdb_skill_create`
 * controller path — prefers `createSkill({ name, description, code,
 * successRate })` (v3 API), falls back to `promote(...)` for legacy
 * controllers.
 */
export interface SkillLibraryWriter {
  createSkill(input: {
    readonly name: string;
    readonly description: string;
    readonly code: string;
    readonly successRate: number;
  }): Promise<SkillLibraryWriteResult | null>;
}

export interface SkillLibraryWriteResult {
  readonly success: boolean;
  readonly skillId: string;
  readonly controller: string;
  readonly error?: string;
}

/**
 * Narrow surface for the ReflexionMemory episode-store path —
 * `handlers/agentdb/reflexion-store.ts` (Phase 6 wire-up). Backed at the cli
 * wiring point by an adapter over `agentdb-tools.ts` `agentdb_reflexion-store`
 * controller path — probes `storeEpisode` (v3) then `store` (legacy) via
 * `getCallableMethod`, with a 2-second timeout enforced cli-side.
 */
export interface ReflexionStoreWriter {
  storeEpisode(input: {
    readonly sessionId: string;
    readonly task: string;
    readonly reward: number;
    readonly success: boolean;
  }): Promise<ReflexionWriteResult | null>;
}

export interface ReflexionWriteResult {
  readonly success: boolean;
  readonly episodeId: string;
  readonly controller: string;
  readonly error?: string;
}

/**
 * Narrow surface for the HierarchicalMemory tier-store path —
 * `handlers/agentdb/hierarchical-store.ts` (Phase 6 wire-up). Backed at the cli
 * wiring point by `hierarchicalStore(...)` (`agentdb-orchestration.ts:269`).
 */
export interface HierarchicalMemoryWriter {
  storeHierarchical(input: {
    readonly key: string;
    readonly value: string;
    readonly tier: 'working' | 'episodic' | 'semantic';
  }): Promise<HierarchicalWriteResult | null>;
}

export interface HierarchicalWriteResult {
  readonly success: boolean;
  readonly id?: string;
  readonly key: string;
  readonly tier: string;
  readonly controller?: string;
  readonly error?: string;
}

/**
 * Narrow surface for the LearningSystem experience-record path —
 * `handlers/agentdb/experience-record.ts` (Phase 6 wire-up). Backed at the cli
 * wiring point by an adapter over `agentdb-tools.ts` `agentdb_experience_record`
 * controller path — calls `startSession()` first (FK requirement on
 * `learning_experiences.session_id`) then `recordExperience({ action, input,
 * output, reward, success })`.
 */
export interface LearningSystemWriter {
  recordExperience(input: {
    readonly task: string;
    readonly input: string;
    readonly output: string;
    readonly reward: number;
    readonly success: boolean;
  }): Promise<LearningWriteResult | null>;
}

export interface LearningWriteResult {
  readonly success: boolean;
  readonly experienceId: string;
  readonly controller: string;
  readonly error?: string;
}

/**
 * Narrow surface for the SonaTrajectoryService record path —
 * `handlers/agentdb/sona-trajectory-store.ts` (Phase 6 wire-up, 'record'
 * action only). Backed at the cli wiring point by an adapter over
 * `agentdb-tools.ts` `agentdb_sona_trajectory_store` controller path —
 * resolves SonaTrajectoryService and calls `recordTrajectory({ pattern,
 * agentType, type, reward })`. The controller is pure-compute (in-memory
 * RL store, no SQLite persistence) — that is by design (cli L2031-2037).
 */
export interface SonaTrajectoryWriter {
  recordTrajectory(input: {
    readonly pattern: string;
    readonly agentType: string;
    readonly type: string;
    readonly reward: number;
  }): Promise<SonaTrajectoryWriteResult | null>;
}

export interface SonaTrajectoryWriteResult {
  readonly success: boolean;
  readonly trajectoryId?: string;
  readonly controller: string;
  readonly error?: string;
}

/**
 * Narrow surface for the multi-controller feedback fan-out —
 * `handlers/agentdb/feedback.ts` (Phase 6 wire-up). Backed at the cli wiring
 * point by `recordFeedback(...)` (`agentdb-orchestration.ts:85`) which routes
 * through `routeFeedbackOp({ type: 'record', ... })` fanning out across
 * LearningSystem + ReasoningBank controllers.
 */
export interface FeedbackRecorder {
  recordFeedback(input: {
    readonly taskId: string;
    readonly success: boolean;
    readonly quality: number;
    readonly agent?: string;
  }): Promise<FeedbackWriteResult | null>;
}

export interface FeedbackWriteResult {
  readonly success: boolean;
  readonly controller: string;
  readonly updated: number;
  readonly error?: string;
}

/**
 * Narrow surface for the CausalMemoryGraph edge-recording path —
 * `handlers/agentdb/causal-edge.ts` (ADR-0181 Item 3 wire-up, 2026-05-16).
 * Backed at the cli wiring point by `recordCausalEdge(...)`
 * (`agentdb-orchestration.ts:150`) which delegates to `routeCausalOp({ type:
 * 'edge', ... })` — that helper tries `getController('causalGraph').addEdge`
 * first and, when the controller is unwired (today's state — ADR-0147 R7
 * gap on string→numeric memoryId mapping), falls through to a router-fallback
 * `memory_store` write under namespace `'causal-edges'`.
 *
 * String-shaped payload mirrors the cli tool's `agentdb_causal-edge` input
 * (`agentdb-tools.ts:344-378`); the controller-side numeric/enum signature is
 * NOT exposed here because the cli call-site never has those values.
 *
 * Adapter MUST resolve `recordCausalEdge` via deferred dynamic import per call
 * (no module/closure caching) so a controller swap mid-process is observed at
 * the next dispatch — `routeCausalOp` itself awaits `ensureRegistry()` per
 * call.
 */
export interface CausalGraphWriter {
  recordEdge(input: {
    readonly sourceId: string;
    readonly targetId: string;
    readonly relation: string;
    readonly weight?: number;
  }): Promise<CausalGraphWriteResult | null>;
}

export interface CausalGraphWriteResult {
  readonly success: boolean;
  readonly controller: string;
  readonly error?: string;
}

/**
 * The capability bundle threaded onto `MutationContext` (ADR-0180 F4-2 Phase C).
 * Every field is OPTIONAL — `initialize(config)` wires whatever subset of
 * factories was supplied. A handler reaching for an unwired capability fails
 * loud at the `require*` accessor below, never silently degrades.
 *
 * Mutation-side handlers see `taskRouter` (route trajectory computation) and
 * `embeddingScorer` (vectorize the task for the RVF write). They do NOT see
 * `patternReader` — that is a read-only capability (ADR-0166 axis separation).
 */
export interface MutationCapabilities {
  readonly taskRouter?: TaskRouter;
  readonly embeddingScorer?: EmbeddingScorer;
  readonly reasoningBankWriter?: ReasoningBankWriter;
  readonly skillLibraryWriter?: SkillLibraryWriter;
  readonly reflexionStoreWriter?: ReflexionStoreWriter;
  readonly hierarchicalMemoryWriter?: HierarchicalMemoryWriter;
  readonly learningSystemWriter?: LearningSystemWriter;
  readonly sonaTrajectoryWriter?: SonaTrajectoryWriter;
  readonly feedbackRecorder?: FeedbackRecorder;
  readonly causalGraphWriter?: CausalGraphWriter;
  /**
   * Fail-loud accessor for `taskRouter`. Handlers call
   * `ctx.capabilities.requireTaskRouter()` instead of `ctx.capabilities
   * .taskRouter!` so the failure is a descriptive throw, not a `TypeError` on
   * `undefined` (`feedback-no-fallbacks`).
   */
  requireTaskRouter(): TaskRouter;
  /** Fail-loud accessor for `embeddingScorer`. See `requireTaskRouter`. */
  requireEmbeddingScorer(): EmbeddingScorer;
  /** Fail-loud accessor for `reasoningBankWriter`. */
  requireReasoningBankWriter(): ReasoningBankWriter;
  /** Fail-loud accessor for `skillLibraryWriter`. */
  requireSkillLibraryWriter(): SkillLibraryWriter;
  /** Fail-loud accessor for `reflexionStoreWriter`. */
  requireReflexionStoreWriter(): ReflexionStoreWriter;
  /** Fail-loud accessor for `hierarchicalMemoryWriter`. */
  requireHierarchicalMemoryWriter(): HierarchicalMemoryWriter;
  /** Fail-loud accessor for `learningSystemWriter`. */
  requireLearningSystemWriter(): LearningSystemWriter;
  /** Fail-loud accessor for `sonaTrajectoryWriter`. */
  requireSonaTrajectoryWriter(): SonaTrajectoryWriter;
  /** Fail-loud accessor for `feedbackRecorder`. */
  requireFeedbackRecorder(): FeedbackRecorder;
  /** Fail-loud accessor for `causalGraphWriter`. */
  requireCausalGraphWriter(): CausalGraphWriter;
}

/**
 * The capability bundle threaded onto `ReadContext`. Read handlers see
 * `embeddingScorer` (re-embed the query for fresh-similarity ranking) and
 * `patternReader` (the SQLite carve-out fusion read). They do NOT see
 * `taskRouter` — routing is a MUTATING surface (`agentdb_route` is a
 * `GuardedWrite`), so it is absent from the read-side bundle by construction.
 */
export interface ReadCapabilities {
  readonly embeddingScorer?: EmbeddingScorer;
  readonly patternReader?: PatternReader;
  readonly gnnTelemetryReader?: GNNTelemetryReader;
  readonly semanticRouteReader?: SemanticRouteReader;
  /** Fail-loud accessor for `embeddingScorer`. See `MutationCapabilities.requireTaskRouter`. */
  requireEmbeddingScorer(): EmbeddingScorer;
  /** Fail-loud accessor for `patternReader`. See `MutationCapabilities.requireTaskRouter`. */
  requirePatternReader(): PatternReader;
  /** Fail-loud accessor for `gnnTelemetryReader`. See `MutationCapabilities.requireTaskRouter`. */
  requireGnnTelemetryReader(): GNNTelemetryReader;
  /** Fail-loud accessor for `semanticRouteReader`. See `MutationCapabilities.requireTaskRouter`. */
  requireSemanticRouteReader(): SemanticRouteReader;
}

/**
 * Lazy factory inputs for `ArchivistInitConfig`. Each capability is supplied as
 * a *factory* (`() => Capability`) rather than an eager instance — `initialize()`
 * invokes a factory at most once, only if present, so an idle archivist never
 * force-constructs an embedding pipeline or opens the router.
 *
 * Where a capability genuinely cannot be threaded from `initialize(config)`
 * because the backing controller is constructed in a *different* process than
 * the archivist (the cli process, not the archivist's), the field is simply
 * left unsupplied and the handler's gap is re-tagged `TODO(F4-3-callsite)` — the
 * cli-delegation phase's job, not Phase C's.
 */
export interface CapabilityFactories {
  /** Lazy `TaskRouter` — adapts the cli `routeTask(...)` path down to the narrow surface. */
  readonly taskRouterFactory?: () => TaskRouter;
  /** Lazy `EmbeddingScorer` — adapts `controllers/EmbeddingService` down to the narrow surface. */
  readonly embeddingScorerFactory?: () => EmbeddingScorer;
  /** Lazy `PatternReader` — adapts the ReasoningBank patterns-table fusion read down to the narrow surface. */
  readonly patternReaderFactory?: () => PatternReader;
  /** Lazy `ReasoningBankWriter` — adapts the cli `storePattern(...)` path. */
  readonly reasoningBankWriterFactory?: () => ReasoningBankWriter;
  /** Lazy `SkillLibraryWriter` — adapts the cli `agentdb_skill_create` controller path. */
  readonly skillLibraryWriterFactory?: () => SkillLibraryWriter;
  /** Lazy `ReflexionStoreWriter` — adapts the cli `agentdb_reflexion-store` controller path. */
  readonly reflexionStoreWriterFactory?: () => ReflexionStoreWriter;
  /** Lazy `HierarchicalMemoryWriter` — adapts the cli `hierarchicalStore(...)` path. */
  readonly hierarchicalMemoryWriterFactory?: () => HierarchicalMemoryWriter;
  /** Lazy `LearningSystemWriter` — adapts the cli `agentdb_experience_record` controller path. */
  readonly learningSystemWriterFactory?: () => LearningSystemWriter;
  /** Lazy `SonaTrajectoryWriter` — adapts the cli `agentdb_sona_trajectory_store` record path. */
  readonly sonaTrajectoryWriterFactory?: () => SonaTrajectoryWriter;
  /** Lazy `FeedbackRecorder` — adapts the cli `recordFeedback(...)` path. */
  readonly feedbackRecorderFactory?: () => FeedbackRecorder;
  /** Lazy `GNNTelemetryReader` — adapts the cli `getController('gnnService')` telemetry surface. */
  readonly gnnTelemetryReaderFactory?: () => GNNTelemetryReader;
  /** Lazy `SemanticRouteReader` — adapts the cli `getController('semanticRouter').route(...)` path. */
  readonly semanticRouteReaderFactory?: () => SemanticRouteReader;
}

/**
 * Build the `MutationCapabilities` bundle from resolved (already-factory-invoked)
 * capability handles. Archivist-internal — the dispatch path calls this once per
 * mutation dispatch with the handles `initialize(config)` resolved. The
 * `require*` accessors close over the resolved handles and throw a descriptive
 * error naming the missing `ArchivistInitConfig` field if a handler reaches for
 * an unwired capability.
 */
export function makeMutationCapabilities(resolved: {
  readonly taskRouter?: TaskRouter;
  readonly embeddingScorer?: EmbeddingScorer;
  readonly reasoningBankWriter?: ReasoningBankWriter;
  readonly skillLibraryWriter?: SkillLibraryWriter;
  readonly reflexionStoreWriter?: ReflexionStoreWriter;
  readonly hierarchicalMemoryWriter?: HierarchicalMemoryWriter;
  readonly learningSystemWriter?: LearningSystemWriter;
  readonly sonaTrajectoryWriter?: SonaTrajectoryWriter;
  readonly feedbackRecorder?: FeedbackRecorder;
}): MutationCapabilities {
  return {
    taskRouter: resolved.taskRouter,
    embeddingScorer: resolved.embeddingScorer,
    reasoningBankWriter: resolved.reasoningBankWriter,
    skillLibraryWriter: resolved.skillLibraryWriter,
    reflexionStoreWriter: resolved.reflexionStoreWriter,
    hierarchicalMemoryWriter: resolved.hierarchicalMemoryWriter,
    learningSystemWriter: resolved.learningSystemWriter,
    sonaTrajectoryWriter: resolved.sonaTrajectoryWriter,
    feedbackRecorder: resolved.feedbackRecorder,
    requireTaskRouter(): TaskRouter {
      if (!resolved.taskRouter) {
        throw new Error(
          'archivist: this handler needs the TaskRouter capability, but no taskRouterFactory ' +
            'was supplied to initialize() — pass { taskRouterFactory } in ArchivistInitConfig',
        );
      }
      return resolved.taskRouter;
    },
    requireEmbeddingScorer(): EmbeddingScorer {
      if (!resolved.embeddingScorer) {
        throw new Error(
          'archivist: this handler needs the EmbeddingScorer capability, but no embeddingScorerFactory ' +
            'was supplied to initialize() — pass { embeddingScorerFactory } in ArchivistInitConfig',
        );
      }
      return resolved.embeddingScorer;
    },
    requireReasoningBankWriter(): ReasoningBankWriter {
      if (!resolved.reasoningBankWriter) {
        throw new Error(
          'archivist: this handler needs the ReasoningBankWriter capability, but no reasoningBankWriterFactory ' +
            'was supplied to initialize() — pass { reasoningBankWriterFactory } in ArchivistInitConfig',
        );
      }
      return resolved.reasoningBankWriter;
    },
    requireSkillLibraryWriter(): SkillLibraryWriter {
      if (!resolved.skillLibraryWriter) {
        throw new Error(
          'archivist: this handler needs the SkillLibraryWriter capability, but no skillLibraryWriterFactory ' +
            'was supplied to initialize() — pass { skillLibraryWriterFactory } in ArchivistInitConfig',
        );
      }
      return resolved.skillLibraryWriter;
    },
    requireReflexionStoreWriter(): ReflexionStoreWriter {
      if (!resolved.reflexionStoreWriter) {
        throw new Error(
          'archivist: this handler needs the ReflexionStoreWriter capability, but no reflexionStoreWriterFactory ' +
            'was supplied to initialize() — pass { reflexionStoreWriterFactory } in ArchivistInitConfig',
        );
      }
      return resolved.reflexionStoreWriter;
    },
    requireHierarchicalMemoryWriter(): HierarchicalMemoryWriter {
      if (!resolved.hierarchicalMemoryWriter) {
        throw new Error(
          'archivist: this handler needs the HierarchicalMemoryWriter capability, but no hierarchicalMemoryWriterFactory ' +
            'was supplied to initialize() — pass { hierarchicalMemoryWriterFactory } in ArchivistInitConfig',
        );
      }
      return resolved.hierarchicalMemoryWriter;
    },
    requireLearningSystemWriter(): LearningSystemWriter {
      if (!resolved.learningSystemWriter) {
        throw new Error(
          'archivist: this handler needs the LearningSystemWriter capability, but no learningSystemWriterFactory ' +
            'was supplied to initialize() — pass { learningSystemWriterFactory } in ArchivistInitConfig',
        );
      }
      return resolved.learningSystemWriter;
    },
    requireSonaTrajectoryWriter(): SonaTrajectoryWriter {
      if (!resolved.sonaTrajectoryWriter) {
        throw new Error(
          'archivist: this handler needs the SonaTrajectoryWriter capability, but no sonaTrajectoryWriterFactory ' +
            'was supplied to initialize() — pass { sonaTrajectoryWriterFactory } in ArchivistInitConfig',
        );
      }
      return resolved.sonaTrajectoryWriter;
    },
    requireFeedbackRecorder(): FeedbackRecorder {
      if (!resolved.feedbackRecorder) {
        throw new Error(
          'archivist: this handler needs the FeedbackRecorder capability, but no feedbackRecorderFactory ' +
            'was supplied to initialize() — pass { feedbackRecorderFactory } in ArchivistInitConfig',
        );
      }
      return resolved.feedbackRecorder;
    },
  };
}

/**
 * Build the `ReadCapabilities` bundle from resolved capability handles.
 * Archivist-internal — the dispatch path calls this once per read dispatch.
 * Same fail-loud `require*` discipline as `makeMutationCapabilities`.
 */
export function makeReadCapabilities(resolved: {
  readonly embeddingScorer?: EmbeddingScorer;
  readonly patternReader?: PatternReader;
  readonly gnnTelemetryReader?: GNNTelemetryReader;
  readonly semanticRouteReader?: SemanticRouteReader;
}): ReadCapabilities {
  return {
    embeddingScorer: resolved.embeddingScorer,
    patternReader: resolved.patternReader,
    gnnTelemetryReader: resolved.gnnTelemetryReader,
    semanticRouteReader: resolved.semanticRouteReader,
    requireEmbeddingScorer(): EmbeddingScorer {
      if (!resolved.embeddingScorer) {
        throw new Error(
          'archivist: this handler needs the EmbeddingScorer capability, but no embeddingScorerFactory ' +
            'was supplied to initialize() — pass { embeddingScorerFactory } in ArchivistInitConfig',
        );
      }
      return resolved.embeddingScorer;
    },
    requirePatternReader(): PatternReader {
      if (!resolved.patternReader) {
        throw new Error(
          'archivist: this handler needs the PatternReader capability, but no patternReaderFactory ' +
            'was supplied to initialize() — pass { patternReaderFactory } in ArchivistInitConfig',
        );
      }
      return resolved.patternReader;
    },
    requireGnnTelemetryReader(): GNNTelemetryReader {
      if (!resolved.gnnTelemetryReader) {
        throw new Error(
          'archivist: this handler needs the GNNTelemetryReader capability, but no gnnTelemetryReaderFactory ' +
            'was supplied to initialize() — pass { gnnTelemetryReaderFactory } in ArchivistInitConfig',
        );
      }
      return resolved.gnnTelemetryReader;
    },
    requireSemanticRouteReader(): SemanticRouteReader {
      if (!resolved.semanticRouteReader) {
        throw new Error(
          'archivist: this handler needs the SemanticRouteReader capability, but no semanticRouteReaderFactory ' +
            'was supplied to initialize() — pass { semanticRouteReaderFactory } in ArchivistInitConfig',
        );
      }
      return resolved.semanticRouteReader;
    },
  };
}
