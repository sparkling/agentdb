// charter: dispatch
// ruvllm_hnsw_create mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<RuvllmHnswCreatePayload>` so every HNSW router
// creation transitions through the archivist's audit-chain (intent → applied |
// rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/ruvllm-tools.ts` `ruvllm_hnsw_create`
// handler — instantiates a WASM HNSW router and journals the create through
// `persistHnswCreate` (cli `ruvllm-store.ts`) to `.claude-flow/ruvllm/hnsw-store.json`.
// The cli's `persistHnswCreate` is a pure `loadHnswStore → store.routers[id] = … →
// saveHnswStore` triple; it collapses to a single `ctx.substrate.withWrite` here
// because the FS-JSON substrate owns the lock + atomic-write semantics. The WASM
// router instantiation + the id mint stay on the cli side (this handler owns the
// persistence step only, matching the progress_sync substrate-seam scope); the
// minted `routerId` arrives in the payload. The cli callsite stays in place until
// the dispatch boundary is wired through cli (Phase 7+).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
} from '../../index.js';
import {
  RUVLLM_HNSW_STORE_ID,
  type RuvllmHnswStore,
  type RuvllmHnswPersistedConfig,
} from './shared.js';

export interface RuvllmHnswCreatePayload {
  readonly routerId: string;
  readonly config: RuvllmHnswPersistedConfig;
}

const STORE_ID = RUVLLM_HNSW_STORE_ID;

export const hnswCreateRuvllmHandler: GuardedWrite<RuvllmHnswCreatePayload> =
  registerMutationHandler<RuvllmHnswCreatePayload>(
    'ruvllm_hnsw_create',
    async (ctx: MutationContext<false>, payload: RuvllmHnswCreatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<RuvllmHnswStore>({ storeId: STORE_ID, key: 'root' });
        const store: RuvllmHnswStore = current ?? { version: '1', routers: {} };

        store.routers[payload.routerId] = {
          id: payload.routerId,
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
