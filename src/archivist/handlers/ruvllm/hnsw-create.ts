// charter: dispatch
// ruvllm_hnsw_create mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<RuvllmHnswCreatePayload>` so every HNSW router
// creation transitions through the archivist's audit-chain (intent → applied |
// rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/ruvllm-tools.ts` `ruvllm_hnsw_create`
// handler — instantiates a WASM HNSW router and journals the create through
// `persistHnswCreate` to `.claude-flow/ruvllm/hnsw-store.json`. The cli callsite
// stays in place until the dispatch boundary is wired through cli (mirroring
// the memory/* and hive-mind/* pending wire-ups). This file establishes the
// registration shape the dispatch path will resolve through
// `ctx.substrate.withWrite` + `makeFsJsonSubstrate(hnsw-store.json)`.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

export interface RuvllmHnswCreatePayload {
  readonly dimensions: number;
  readonly maxPatterns: number;
  readonly efSearch?: number;
}

const STORE_ID = 'ruvllm_hnsw_create' as StoreId;

export const hnswCreateRuvllmHandler: GuardedWrite<RuvllmHnswCreatePayload> =
  registerMutationHandler<RuvllmHnswCreatePayload>(
    'ruvllm_hnsw_create',
    async (ctx: MutationContext<false>, _payload: RuvllmHnswCreatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: ruvllm_hnsw_create handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/ruvllm-tools.ts ruvllm_hnsw_create handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
