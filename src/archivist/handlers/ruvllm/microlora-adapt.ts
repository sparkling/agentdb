// charter: dispatch
// ruvllm_microlora_adapt mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<RuvllmMicroLoraAdaptPayload>` so every MicroLoRA
// weight adapt transitions through the archivist's audit-chain (intent →
// applied | rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/ruvllm-tools.ts`
// `ruvllm_microlora_adapt` handler — drives a MicroLoRA adapter forward with
// a quality signal (+ optional learningRate / success) and journals the adapt
// through `persistMicroLoraAdapt` to `.claude-flow/ruvllm/microlora-store.json`.
// The cli callsite stays in place until the dispatch boundary is wired through
// cli. This file establishes the registration shape the dispatch path will
// resolve through `ctx.substrate.withWrite` +
// `makeFsJsonSubstrate(microlora-store.json)`.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

export interface RuvllmMicroLoraAdaptPayload {
  readonly loraId: string;
  readonly quality: number;
  readonly learningRate?: number;
  readonly success?: boolean;
}

const STORE_ID = 'ruvllm_microlora_adapt' as StoreId;

export const microLoraAdaptRuvllmHandler: GuardedWrite<RuvllmMicroLoraAdaptPayload> =
  registerMutationHandler<RuvllmMicroLoraAdaptPayload>(
    'ruvllm_microlora_adapt',
    async (ctx: MutationContext<false>, _payload: RuvllmMicroLoraAdaptPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: ruvllm_microlora_adapt handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/ruvllm-tools.ts ruvllm_microlora_adapt handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
