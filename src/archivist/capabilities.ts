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
  /**
   * Fail-loud accessor for `taskRouter`. Handlers call
   * `ctx.capabilities.requireTaskRouter()` instead of `ctx.capabilities
   * .taskRouter!` so the failure is a descriptive throw, not a `TypeError` on
   * `undefined` (`feedback-no-fallbacks`).
   */
  requireTaskRouter(): TaskRouter;
  /** Fail-loud accessor for `embeddingScorer`. See `requireTaskRouter`. */
  requireEmbeddingScorer(): EmbeddingScorer;
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
  /** Fail-loud accessor for `embeddingScorer`. See `MutationCapabilities.requireTaskRouter`. */
  requireEmbeddingScorer(): EmbeddingScorer;
  /** Fail-loud accessor for `patternReader`. See `MutationCapabilities.requireTaskRouter`. */
  requirePatternReader(): PatternReader;
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
}): MutationCapabilities {
  return {
    taskRouter: resolved.taskRouter,
    embeddingScorer: resolved.embeddingScorer,
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
}): ReadCapabilities {
  return {
    embeddingScorer: resolved.embeddingScorer,
    patternReader: resolved.patternReader,
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
  };
}
