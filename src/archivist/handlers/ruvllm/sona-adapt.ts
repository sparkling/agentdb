// charter: dispatch
// ruvllm_sona_adapt mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<RuvllmSonaAdaptPayload>` so every SONA quality
// adaptation transitions through the archivist's audit-chain (intent → applied |
// rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/ruvllm-tools.ts` `ruvllm_sona_adapt`
// handler — drives a SONA instance forward by one quality signal and journals
// the adapt (quality) through `persistSonaAdapt` to
// `.claude-flow/ruvllm/sona-store.json`. The cli callsite stays in place until
// the dispatch boundary is wired through cli. This file establishes the
// registration shape the dispatch path will resolve through
// `ctx.substrate.withWrite` + `makeFsJsonSubstrate(sona-store.json)`.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

export interface RuvllmSonaAdaptPayload {
  readonly sonaId: string;
  readonly quality: number;
}

const STORE_ID = 'ruvllm_sona_adapt' as StoreId;

export const sonaAdaptRuvllmHandler: GuardedWrite<RuvllmSonaAdaptPayload> =
  registerMutationHandler<RuvllmSonaAdaptPayload>(
    'ruvllm_sona_adapt',
    async (ctx: MutationContext<false>, _payload: RuvllmSonaAdaptPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: ruvllm_sona_adapt handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/ruvllm-tools.ts ruvllm_sona_adapt handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
