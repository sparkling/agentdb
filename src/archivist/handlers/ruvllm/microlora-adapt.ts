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
  /**
   * ADR-0231 Wave 2 (Q-3 fix): per-call input vector. Length MUST equal the
   * loraId's stored `config.inputDim` (validated against the store at handler
   * time; payload-only invariants additionally reject all-zero per
   * feedback-no-fallbacks — the pre-fork zero-input no-op bug).
   */
  readonly input: ReadonlyArray<number>;
  readonly quality: number;
  readonly learningRate?: number;
  readonly success?: boolean;
  /**
   * ADR-0231 Wave 2: opt-in EWC++ consolidation pass after the adapt step.
   * Optional; defaults to caller intent (undefined ⇒ no consolidation).
   */
  readonly consolidate?: boolean;
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

        // ADR-0231 Wave 2: input.length must equal the configured inputDim.
        // The payload-only `inputIsNotAllZero` invariant cannot see the store,
        // so this dimension check fails loud here (per feedback-no-fallbacks).
        const expectedDim = instance.config.inputDim;
        if (payload.input.length !== expectedDim) {
          throw new Error(
            `archivist: ruvllm_microlora_adapt — input.length=${payload.input.length} must equal ` +
            `loraId='${payload.loraId}' config.inputDim=${expectedDim} (ADR-0231 Wave 2)`,
          );
        }

        instance.journal.push({
          op: 'adapt',
          input: payload.input,
          quality: payload.quality,
          learningRate: payload.learningRate,
          success: payload.success,
          consolidate: payload.consolidate,
        });

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: microLoraAdaptInvariants,
      cacheScope: 'global',
    },
  );
