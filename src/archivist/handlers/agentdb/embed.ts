// charter: dispatch
// agentdb_embed read handler (ADR-0180 Phase 6, §Architecture · Read-path return
// shape + §Read-path cache writes persistence-boundary rule).
//
// Classification: READ. Embedding generation is a pure derivation from the input
// text — no audit-chain ceremony, no MutationGuard. The A9 EnhancedEmbeddingService
// populates an in-memory LRU cache as a side-effect of `enhanced.embed(text)`;
// those writes are MEMORY-ONLY and die with the process, so they sit on the READ
// side of the persistence boundary (Q3, §Architecture). If the cache is later
// reclassified as persistent (e.g. SQLite-backed), this handler must move to the
// MUTATING side and re-route through `registerMutationHandler`.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_embed` handler (line 1396) — delegates to the package-level `embed(text)`
// helper in `agentdb-orchestration.ts:478` which awaits deferred controllers,
// resolves the A9 EnhancedEmbeddingService, and runs the multi-provider fallback
// chain (transformers → claude → openai per controller config). Per ADR-0180
// §Migration window, the cli callsite stays authoritative until the dispatch
// boundary is wired — this file establishes the registration shape the dispatch
// path will resolve.

import { registerReadHandler, type GuardedRead, type ReadContext } from '../../index';

/** Input mirroring `agentdb-tools.ts:1397-1405` — single required `text` field. */
export interface AgentdbEmbedQuery {
  readonly text: string;
}

/**
 * Result shape mirroring the `embed(...)` helper return
 * (`agentdb-orchestration.ts:478-480`). `cached` reports the embedding-service
 * cache state on this call; the broader cache-write side-effect (LRU insertion)
 * is surfaced separately via `ReadContext.cacheHints.wrote_cache` at the
 * dispatch boundary.
 */
export interface AgentdbEmbedResult {
  readonly success: boolean;
  readonly embedding?: ReadonlyArray<number>;
  readonly dimension?: number;
  readonly provider?: string;
  readonly cached?: boolean;
  readonly error?: string;
}

// TODO(ADR-0180 Phase 6 wire-up): port the body of cli/src/mcp-tools/agentdb-tools.ts
// `agentdb_embed` handler: (a) resolve `enhancedEmbeddingService` via
// `ctx.substrate` (read-only narrow) after `waitForDeferred()`; (b) call
// `enhanced.embed(text)`, handling both Float32Array and `{embedding}` return
// shapes per orchestration.ts:494-512; (c) read provider via
// `enhanced.getStats()?.model?.provider`; (d) record the LRU-cache population
// on `ctx.cacheHints` — `wrote_cache=true` whenever the embedding service
// inserts a fresh entry, with `cache_keys` listing the digest used by the
// service. These hints are ADVISORY ONLY (Q3, §Read-path cache writes) — they
// participate in observability/telemetry but NOT in the audit chain; the
// archivist's audit-writer never consumes `ReadContext.cacheHints`.
export const embedHandler: GuardedRead<AgentdbEmbedQuery, AgentdbEmbedResult> =
  registerReadHandler<AgentdbEmbedQuery, AgentdbEmbedResult>(
    'agentdb_embed',
    async (_ctx: ReadContext, _payload: AgentdbEmbedQuery): Promise<AgentdbEmbedResult> => {
      throw new Error(
        'archivist: agentdb_embed handler body pending Phase 6 wire-up; ' +
        'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts agentdb_embed handler',
      );
    },
    { cacheScope: 'global' },
  );
