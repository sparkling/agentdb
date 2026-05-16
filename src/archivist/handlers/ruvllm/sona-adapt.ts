// charter: dispatch
// ruvllm_sona_adapt mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<RuvllmSonaAdaptPayload>` so every SONA quality
// adaptation transitions through the archivist's audit-chain (intent → applied |
// rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/ruvllm-tools.ts` `ruvllm_sona_adapt`
// handler — drives a SONA instance forward by one quality signal and journals
// the adapt (quality) through `persistSonaAdapt` (cli `ruvllm-store.ts`) to
// `.claude-flow/ruvllm/sona-store.json`. `persistSonaAdapt` is a pure
// `loadSonaStore → rec.journal.push({op:'adapt',quality}) → saveSonaStore` triple;
// it collapses to a single `ctx.substrate.withWrite` here because the FS-JSON
// substrate owns the lock + atomic-write semantics. The WASM `sona.adapt(quality)`
// call stays cli-side (this handler owns the journal-append persistence step
// only). `persistSonaAdapt` returns `false` on a missing instance; per
// `feedback-no-fallbacks` this handler fails loud instead. The cli callsite stays
// in place until the dispatch boundary is wired through cli (Phase 7+).

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext } from '../../index.js';
import { RUVLLM_SONA_STORE_ID, type RuvllmSonaStore } from './shared.js';

export interface RuvllmSonaAdaptPayload {
  readonly sonaId: string;
  readonly quality: number;
}

const STORE_ID = RUVLLM_SONA_STORE_ID;

export const sonaAdaptRuvllmHandler: GuardedWrite<RuvllmSonaAdaptPayload> =
  registerMutationHandler<RuvllmSonaAdaptPayload>(
    'ruvllm_sona_adapt',
    async (ctx: MutationContext<false>, payload: RuvllmSonaAdaptPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const store = await handle.read<RuvllmSonaStore>({ storeId: STORE_ID, key: 'root' });
        const instance = store?.instances[payload.sonaId];
        if (store === undefined || instance === undefined) {
          throw new Error(
            `archivist: ruvllm_sona_adapt — SONA instance '${payload.sonaId}' not found in sona-store; ` +
            'an adapt against a non-existent instance is a caller bug (cli persistSonaAdapt would ' +
            'silently return false here — the archivist fails loud per feedback-no-fallbacks)',
          );
        }

        instance.journal.push({ op: 'adapt', quality: payload.quality });

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
