// charter: dispatch
// ruvllm_hnsw_add mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<RuvllmHnswAddPayload>` so every HNSW pattern
// add transitions through the archivist's audit-chain (intent → applied |
// rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/ruvllm-tools.ts` `ruvllm_hnsw_add`
// handler — appends a pattern to the WASM HNSW router and journals the add
// (name + embedding + optional metadata) through `persistHnswAdd` to
// `.claude-flow/ruvllm/hnsw-store.json`. The cli callsite stays in place until
// the dispatch boundary is wired through cli. This file establishes the
// registration shape the dispatch path will resolve through
// `ctx.substrate.withWrite` + `makeFsJsonSubstrate(hnsw-store.json)`.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

export interface RuvllmHnswAddPayload {
  readonly routerId: string;
  readonly name: string;
  readonly embedding: ReadonlyArray<number>;
  readonly metadata?: Record<string, unknown>;
}

const STORE_ID = 'ruvllm_hnsw_add' as StoreId;

export const hnswAddRuvllmHandler: GuardedWrite<RuvllmHnswAddPayload> =
  registerMutationHandler<RuvllmHnswAddPayload>(
    'ruvllm_hnsw_add',
    async (ctx: MutationContext<false>, _payload: RuvllmHnswAddPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: ruvllm_hnsw_add handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/ruvllm-tools.ts ruvllm_hnsw_add handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
