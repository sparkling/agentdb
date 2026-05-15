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
// `agentdb_embed` handler (line 1447) — delegates to the package-level `embed(text)`
// helper in `agentdb-orchestration.ts:478` which awaits deferred controllers,
// resolves the A9 EnhancedEmbeddingService, and runs the multi-provider fallback
// chain (transformers → claude → openai per controller config).
//
// F4-2 wire-up (ADR-0181 Phase 4): the cli's multi-provider fallback chain is
// composed at controller-construction time inside `EnhancedEmbeddingService`;
// the narrow `EmbeddingScorer` capability surface (capabilities.ts:88) returns
// the resolved `Float32Array` directly. This handler asks the capability for the
// embedding — provider negotiation lives in the wiring point, not here.

import { registerReadHandler, type GuardedRead, type ReadContext } from '../../index.js';

/** Input mirroring `agentdb-tools.ts` `agentdb_embed` schema — single required `text` field. */
export interface AgentdbEmbedQuery {
  readonly text: string;
}

/**
 * Result shape mirroring the `embed(...)` helper return
 * (`agentdb-orchestration.ts:478-480`) — only the fields the narrow
 * `EmbeddingScorer` capability surface can honor are returned here. The cli
 * helper's `provider` / `cached` fields come from controller stats
 * (`enhanced.getStats()?.model?.provider`) which the narrow capability does not
 * expose; the cli boundary may compose those post-dispatch if needed.
 */
export interface AgentdbEmbedResult {
  readonly success: true;
  readonly embedding: ReadonlyArray<number>;
  readonly dimension: number;
}

export const embedHandler: GuardedRead<AgentdbEmbedQuery, AgentdbEmbedResult> =
  registerReadHandler<AgentdbEmbedQuery, AgentdbEmbedResult>(
    'agentdb_embed',
    async (ctx: ReadContext, payload: AgentdbEmbedQuery): Promise<AgentdbEmbedResult> => {
      const scorer = ctx.capabilities.requireEmbeddingScorer();
      const vector = await scorer.embed(payload.text);
      if (vector.length === 0) {
        // Empty vector violates the EmbeddingScorer contract — fail loud rather
        // than return a `success: true` envelope wrapping a zero-length array
        // (`feedback-no-fallbacks`). A length of 0 means the underlying service
        // degraded silently; that must not be laundered into a successful
        // response.
        throw new Error(
          'archivist: agentdb_embed received an empty vector from EmbeddingScorer.embed — ' +
            'embedding service degraded silently',
        );
      }
      return {
        success: true,
        embedding: Array.from(vector),
        dimension: vector.length,
      };
    },
    { cacheScope: 'global' },
  );
