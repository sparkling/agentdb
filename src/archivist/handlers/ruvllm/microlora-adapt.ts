// charter: dispatch
// ruvllm_microlora_adapt mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<RuvllmMicroLoraAdaptPayload>` so every MicroLoRA
// weight adapt transitions through the archivist's audit-chain (intent →
// applied | rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/ruvllm-tools.ts`
// `ruvllm_microlora_adapt` handler — drives a MicroLoRA adapter forward with
// a quality signal (+ optional learningRate / success) and journals the adapt
// through `persistMicroLoraAdapt` (cli `ruvllm-store.ts`) to
// `.claude-flow/ruvllm/microlora-store.json`. `persistMicroLoraAdapt` is a pure
// `loadMicroLoraStore → rec.journal.push({op:'adapt',…}) → saveMicroLoraStore`
// triple; it collapses to a single `ctx.substrate.withWrite` here because the
// FS-JSON substrate owns the lock + atomic-write semantics. The WASM
// `lora.adapt(...)` call stays cli-side (this handler owns the journal-append
// persistence step only). `persistMicroLoraAdapt` returns `false` on a missing
// instance; per `feedback-no-fallbacks` this handler fails loud instead. The cli
// callsite stays in place until the dispatch boundary is wired through cli (Phase 7+).

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext } from '../../index.js';
import { microLoraAdaptInvariants } from '../../invariants/ruvllm/microlora-adapt.js';
import { RUVLLM_MICROLORA_STORE_ID, type RuvllmMicroLoraStore } from './shared.js';

export interface RuvllmMicroLoraAdaptPayload {
  readonly loraId: string;
  readonly quality: number;
  readonly learningRate?: number;
  readonly success?: boolean;
}

const STORE_ID = RUVLLM_MICROLORA_STORE_ID;

export const microLoraAdaptRuvllmHandler: GuardedWrite<RuvllmMicroLoraAdaptPayload> =
  registerMutationHandler<RuvllmMicroLoraAdaptPayload>(
    'ruvllm_microlora_adapt',
    async (ctx: MutationContext<false>, payload: RuvllmMicroLoraAdaptPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const store = await handle.read<RuvllmMicroLoraStore>({ storeId: STORE_ID, key: 'root' });
        const instance = store?.instances[payload.loraId];
        if (store === undefined || instance === undefined) {
          throw new Error(
            `archivist: ruvllm_microlora_adapt — MicroLoRA instance '${payload.loraId}' not found in ` +
            'microlora-store; an adapt against a non-existent instance is a caller bug (cli ' +
            'persistMicroLoraAdapt would silently return false here — the archivist fails loud per ' +
            'feedback-no-fallbacks)',
          );
        }

        instance.journal.push({
          op: 'adapt',
          quality: payload.quality,
          learningRate: payload.learningRate,
          success: payload.success,
        });

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: microLoraAdaptInvariants,
      cacheScope: 'global',
    },
  );
