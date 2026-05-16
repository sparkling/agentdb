// charter: dispatch
// ruvllm_microlora_create mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<RuvllmMicroLoraCreatePayload>` so every MicroLoRA
// adapter creation transitions through the archivist's audit-chain (intent →
// applied | rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/ruvllm-tools.ts`
// `ruvllm_microlora_create` handler — instantiates an ultra-lightweight LoRA
// adapter (ranks 1-4) and journals the create (inputDim / outputDim / rank /
// alpha) through `persistMicroLoraCreate` (cli `ruvllm-store.ts`) to
// `.claude-flow/ruvllm/microlora-store.json`. `persistMicroLoraCreate` is a pure
// `loadMicroLoraStore → store.instances[id] = … → saveMicroLoraStore` triple; it
// collapses to a single `ctx.substrate.withWrite` here because the FS-JSON
// substrate owns the lock + atomic-write semantics. The WASM LoRA instantiation
// + the id mint stay cli-side (this handler owns the persistence step only); the
// minted `loraId` arrives in the payload. The cli callsite stays in place until
// the dispatch boundary is wired through cli (Phase 7+).

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext } from '../../index.js';
import {
  RUVLLM_MICROLORA_STORE_ID,
  type RuvllmMicroLoraStore,
  type RuvllmMicroLoraPersistedConfig,
} from './shared.js';

export interface RuvllmMicroLoraCreatePayload {
  readonly loraId: string;
  readonly config: RuvllmMicroLoraPersistedConfig;
}

const STORE_ID = RUVLLM_MICROLORA_STORE_ID;

export const microLoraCreateRuvllmHandler: GuardedWrite<RuvllmMicroLoraCreatePayload> =
  registerMutationHandler<RuvllmMicroLoraCreatePayload>(
    'ruvllm_microlora_create',
    async (ctx: MutationContext<false>, payload: RuvllmMicroLoraCreatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<RuvllmMicroLoraStore>({ storeId: STORE_ID, key: 'root' });
        const store: RuvllmMicroLoraStore = current ?? { version: '1', instances: {} };

        store.instances[payload.loraId] = {
          id: payload.loraId,
          createdAt: new Date().toISOString(),
          config: payload.config,
          journal: [],
        };

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
