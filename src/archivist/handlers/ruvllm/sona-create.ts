// charter: dispatch
// ruvllm_sona_create mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<RuvllmSonaCreatePayload>` so every SONA instant
// creation transitions through the archivist's audit-chain (intent → applied |
// rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/ruvllm-tools.ts` `ruvllm_sona_create`
// handler — instantiates a SONA instant-adaptation loop and journals the create
// (hiddenDim / learningRate / patternCapacity) through `persistSonaCreate` (cli
// `ruvllm-store.ts`) to `.claude-flow/ruvllm/sona-store.json`. `persistSonaCreate`
// is a pure `loadSonaStore → store.instances[id] = … → saveSonaStore` triple; it
// collapses to a single `ctx.substrate.withWrite` here because the FS-JSON
// substrate owns the lock + atomic-write semantics. The WASM SONA instantiation
// + the id mint stay cli-side (this handler owns the persistence step only); the
// minted `sonaId` arrives in the payload. The cli callsite stays in place until
// the dispatch boundary is wired through cli (Phase 7+).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
} from '../../index.js';
import {
  RUVLLM_SONA_STORE_ID,
  type RuvllmSonaStore,
  type RuvllmSonaPersistedConfig,
} from './shared.js';

export interface RuvllmSonaCreatePayload {
  readonly sonaId: string;
  readonly config: RuvllmSonaPersistedConfig;
}

const STORE_ID = RUVLLM_SONA_STORE_ID;

export const sonaCreateRuvllmHandler: GuardedWrite<RuvllmSonaCreatePayload> =
  registerMutationHandler<RuvllmSonaCreatePayload>(
    'ruvllm_sona_create',
    async (ctx: MutationContext<false>, payload: RuvllmSonaCreatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<RuvllmSonaStore>({ storeId: STORE_ID, key: 'root' });
        const store: RuvllmSonaStore = current ?? { version: '1', instances: {} };

        store.instances[payload.sonaId] = {
          id: payload.sonaId,
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
