// charter: type-enforcement
// Runtime shape for ReadContext (ADR-0180 §Type enforcement, Follow-up #3).
// Reads have no audit-chain ceremony — `ReadContext` carries no `substrate` field
// on the public interface; read handlers receive `ReadOnlySubstrateAccess` via the
// archivist's dispatch, not via a context property. Cache hints feed the read-path
// cache-writes persistence-boundary rule (Q3, §Architecture).

import type { ReadOnlySubstrateAccess } from './types';
import type { ReadCapabilities } from './capabilities';

/** Read-only cache surface delivered via `ReadContext.cache`. */
export interface ReadOnlyCache {
  get<R>(key: string): R | undefined;
}

/** Cache-hint observability (Q3 §Read-path cache writes). Advisory only. */
export interface CacheHints {
  readonly wrote_cache: boolean;
  readonly cache_keys: ReadonlyArray<string>;
}

/**
 * Public-facing ReadContext. `intent` is opt-in but recommended for read-side
 * features (cache routing, BM25+semantic fusion). `cacheHints` is populated by
 * read handlers that mutate in-memory caches as a side-effect (memory-only;
 * persistent caches reclassify MUTATING per §Architecture).
 */
export interface ReadContext {
  readonly originatingTool: string;
  readonly requestId: string;
  readonly intent?: string;
  readonly cacheHints?: CacheHints;
  readonly cache: ReadOnlyCache;
  /** Branded read-only substrate handle. Reads use it for lookups + fusion. */
  readonly substrate: ReadOnlySubstrateAccess;

  /**
   * Resolved project root (`ArchivistInitConfig.projectRoot ?? process.cwd()`) —
   * the same value the substrate layer uses for FS-JSON paths. Threaded onto
   * read contexts for parity with `MutationContext.projectRoot` (ADR-0180 F4-2
   * Phase C); read handlers needing a project-relative path use this rather than
   * `process.cwd()`.
   */
  readonly projectRoot: string;

  /**
   * Narrow capability handles wired by `initialize(config)` (ADR-0180 F4-2
   * Phase C). NOT raw controllers — see `capabilities.ts`. Read-side:
   * `embeddingScorer` (re-embed the query for fresh-similarity ranking) +
   * `patternReader` (the SQLite carve-out ReasoningBank fusion read). No
   * `taskRouter` — routing is MUTATING, absent from the read bundle by
   * construction. Unwired capabilities fail loud at the `require*` accessor.
   */
  readonly capabilities: ReadCapabilities;
}

/** Internal factory inputs — not re-exported from archivist `index.ts`. */
export interface CreateReadContextInput {
  readonly originatingTool: string;
  readonly requestId: string;
  readonly intent?: string;
  readonly cache: ReadOnlyCache;
  readonly substrate: ReadOnlySubstrateAccess;
  readonly projectRoot: string;
  readonly capabilities: ReadCapabilities;
  readonly cacheHints?: CacheHints;
}

/** Archivist-internal constructor. Same access discipline as `createMutationContext`. */
export function createReadContext(input: CreateReadContextInput): ReadContext {
  return {
    originatingTool: input.originatingTool,
    requestId: input.requestId,
    intent: input.intent,
    cache: input.cache,
    substrate: input.substrate,
    projectRoot: input.projectRoot,
    capabilities: input.capabilities,
    cacheHints: input.cacheHints,
  };
}
