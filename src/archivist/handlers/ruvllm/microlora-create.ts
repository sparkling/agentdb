// charter: dispatch
// ruvllm_microlora_create mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<RuvllmMicroLoraCreatePayload>` so every MicroLoRA
// adapter creation transitions through the archivist's audit-chain (intent →
// applied | rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/ruvllm-tools.ts`
// `ruvllm_microlora_create` handler — instantiates an ultra-lightweight LoRA
// adapter (ranks 1-4) and journals the create (inputDim / outputDim / rank /
// alpha) through `persistMicroLoraCreate` to
// `.claude-flow/ruvllm/microlora-store.json`. The cli callsite stays in place
// until the dispatch boundary is wired through cli. This file establishes the
// registration shape the dispatch path will resolve through
// `ctx.substrate.withWrite` + `makeFsJsonSubstrate(microlora-store.json)`.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

export interface RuvllmMicroLoraCreatePayload {
  readonly inputDim: number;
  readonly outputDim: number;
  readonly rank?: number;
  readonly alpha?: number;
}

const STORE_ID = 'ruvllm_microlora_create' as StoreId;

export const microLoraCreateRuvllmHandler: GuardedWrite<RuvllmMicroLoraCreatePayload> =
  registerMutationHandler<RuvllmMicroLoraCreatePayload>(
    'ruvllm_microlora_create',
    async (ctx: MutationContext<false>, _payload: RuvllmMicroLoraCreatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: ruvllm_microlora_create handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/ruvllm-tools.ts ruvllm_microlora_create handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
