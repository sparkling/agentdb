// charter: dispatch
// ruvllm_hnsw_add mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<RuvllmHnswAddPayload>` so every HNSW pattern
// add transitions through the archivist's audit-chain (intent → applied |
// rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/ruvllm-tools.ts` `ruvllm_hnsw_add`
// handler — appends a pattern to the WASM HNSW router and journals the add
// (name + embedding + optional metadata) through `persistHnswAdd` (cli
// `ruvllm-store.ts`) to `.claude-flow/ruvllm/hnsw-store.json`. `persistHnswAdd`
// is a pure `loadHnswStore → rec.journal.push({op:'add',…}) → saveHnswStore`
// triple; it collapses to a single `ctx.substrate.withWrite` here because the
// FS-JSON substrate owns the lock + atomic-write semantics. The WASM
// `router.addPattern` call stays cli-side (this handler owns the journal-append
// persistence step only). `persistHnswAdd` returns `false` on a missing router;
// per `feedback-no-fallbacks` this handler fails loud instead — a journal-append
// to a non-existent router is a caller bug, not a silent no-op. The cli callsite
// stays in place until the dispatch boundary is wired through cli (Phase 7+).

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext } from '../../index.js';
import { RUVLLM_HNSW_STORE_ID, type RuvllmHnswStore } from './shared.js';

export interface RuvllmHnswAddPayload {
  readonly routerId: string;
  readonly name: string;
  readonly embedding: ReadonlyArray<number>;
  readonly metadata?: Record<string, unknown>;
}

const STORE_ID = RUVLLM_HNSW_STORE_ID;

export const hnswAddRuvllmHandler: GuardedWrite<RuvllmHnswAddPayload> =
  registerMutationHandler<RuvllmHnswAddPayload>(
    'ruvllm_hnsw_add',
    async (ctx: MutationContext<false>, payload: RuvllmHnswAddPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const store = await handle.read<RuvllmHnswStore>({ storeId: STORE_ID, key: 'root' });
        const router = store?.routers[payload.routerId];
        if (store === undefined || router === undefined) {
          throw new Error(
            `archivist: ruvllm_hnsw_add — router '${payload.routerId}' not found in hnsw-store; ` +
            'a pattern-add to a non-existent router is a caller bug (cli persistHnswAdd would silently ' +
            'return false here — the archivist fails loud per feedback-no-fallbacks)',
          );
        }

        router.journal.push({
          op: 'add',
          name: payload.name,
          embedding: payload.embedding,
          metadata: payload.metadata,
        });

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
