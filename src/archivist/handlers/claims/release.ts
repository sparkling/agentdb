// charter: dispatch
// claims_release mutation handler (ADR-0180 Phase 5).
// Releases an existing claim. Only the current claimant may release.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/claims-tools.ts` `claims_release`
// handler — loads store, verifies ownership, deletes claim + stealable entries.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';
import type { Claimant, ClaimsStore } from './claim';

export interface ClaimsReleasePayload {
  readonly issueId: string;
  readonly claimant: Claimant;
  readonly reason?: string;
}

const STORE_ID = 'claims' as StoreId;

function formatClaimant(c: Claimant): string {
  return c.type === 'human' ? `human:${c.userId}:${c.name}` : `agent:${c.agentId}:${c.agentType}`;
}

// TODO(ADR-0180 Phase 5 wire-up): port cli `claims_release` body.
export const claimsReleaseHandler: GuardedWrite<ClaimsReleasePayload> =
  registerMutationHandler<ClaimsReleasePayload>(
    'claims_release',
    async (ctx: MutationContext<false>, payload: ClaimsReleasePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const store = await handle.read<ClaimsStore>({ storeId: STORE_ID, key: 'root' });
        if (!store) {
          throw new Error(`claims_release: no claims store`);
        }
        const claim = store.claims[payload.issueId];
        if (!claim) {
          throw new Error(`claims_release: issue '${payload.issueId}' is not claimed`);
        }
        if (formatClaimant(claim.claimant) !== formatClaimant(payload.claimant)) {
          throw new Error(`claims_release: only the current claimant can release`);
        }

        delete store.claims[payload.issueId];
        delete store.stealable[payload.issueId];

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [],
      cacheScope: 'store',
    },
  );
