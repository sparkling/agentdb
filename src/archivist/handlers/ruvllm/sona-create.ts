// charter: dispatch
// ruvllm_sona_create mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<RuvllmSonaCreatePayload>` so every SONA instant
// creation transitions through the archivist's audit-chain (intent → applied |
// rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/ruvllm-tools.ts` `ruvllm_sona_create`
// handler — instantiates a SONA instant-adaptation loop and journals the create
// (hiddenDim / learningRate / patternCapacity) through `persistSonaCreate` to
// `.claude-flow/ruvllm/sona-store.json`. The cli callsite stays in place until
// the dispatch boundary is wired through cli. This file establishes the
// registration shape the dispatch path will resolve through
// `ctx.substrate.withWrite` + `makeFsJsonSubstrate(sona-store.json)`.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

export interface RuvllmSonaCreatePayload {
  readonly hiddenDim?: number;
  readonly learningRate?: number;
  readonly patternCapacity?: number;
}

const STORE_ID = 'ruvllm_sona_create' as StoreId;

export const sonaCreateRuvllmHandler: GuardedWrite<RuvllmSonaCreatePayload> =
  registerMutationHandler<RuvllmSonaCreatePayload>(
    'ruvllm_sona_create',
    async (ctx: MutationContext<false>, _payload: RuvllmSonaCreatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: ruvllm_sona_create handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/ruvllm-tools.ts ruvllm_sona_create handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
