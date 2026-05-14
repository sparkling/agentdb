// charter: dispatch
// claims_accept-handoff mutation handler (ADR-0180 Phase 5).
// Accepts a pending handoff. Target claimant becomes the new owner; status
// flips from 'handoff-pending' back to 'active'.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';
import type { Claimant, ClaimsStore } from './claim';

export interface ClaimsAcceptHandoffPayload {
  readonly issueId: string;
  readonly claimant: Claimant;
}

const STORE_ID = 'claims' as StoreId;

function formatClaimant(c: Claimant): string {
  return c.type === 'human' ? `human:${c.userId}:${c.name}` : `agent:${c.agentId}:${c.agentType}`;
}

// TODO(ADR-0180 Phase 5 wire-up): port cli `claims_accept-handoff` body.
export const claimsAcceptHandoffHandler: GuardedWrite<ClaimsAcceptHandoffPayload> =
  registerMutationHandler<ClaimsAcceptHandoffPayload>(
    'claims_accept-handoff',
    async (ctx: MutationContext<false>, payload: ClaimsAcceptHandoffPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const store = await handle.read<ClaimsStore>({ storeId: STORE_ID, key: 'root' });
        if (!store) {
          throw new Error(`claims_accept-handoff: no claims store`);
        }
        const claim = store.claims[payload.issueId];
        if (!claim) {
          throw new Error(`claims_accept-handoff: issue '${payload.issueId}' is not claimed`);
        }
        if (claim.status !== 'handoff-pending') {
          throw new Error(`claims_accept-handoff: no pending handoff for issue '${payload.issueId}'`);
        }
        if (!claim.handoffTo || formatClaimant(claim.handoffTo) !== formatClaimant(payload.claimant)) {
          throw new Error(`claims_accept-handoff: caller is not the handoff target`);
        }

        const now = new Date().toISOString();
        claim.claimant = payload.claimant;
        claim.status = 'active';
        claim.statusChangedAt = now;
        claim.handoffTo = undefined;
        claim.handoffReason = undefined;

        store.claims[payload.issueId] = claim;

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [],
      cacheScope: 'store',
    },
  );
