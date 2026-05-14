// charter: dispatch
// claims_handoff mutation handler (ADR-0180 Phase 5).
// Requests handoff of an issue from the current claimant to a target claimant.
// Sets status='handoff-pending'; the target accepts via claims_accept-handoff.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';
import type { Claimant, ClaimsStore } from './claim';

export interface ClaimsHandoffPayload {
  readonly issueId: string;
  readonly from: Claimant;
  readonly to: Claimant;
  readonly reason?: string;
  readonly progress?: number;
}

const STORE_ID = 'claims' as StoreId;

function formatClaimant(c: Claimant): string {
  return c.type === 'human' ? `human:${c.userId}:${c.name}` : `agent:${c.agentId}:${c.agentType}`;
}

// TODO(ADR-0180 Phase 5 wire-up): port cli `claims_handoff` body.
export const claimsHandoffHandler: GuardedWrite<ClaimsHandoffPayload> =
  registerMutationHandler<ClaimsHandoffPayload>(
    'claims_handoff',
    async (ctx: MutationContext<false>, payload: ClaimsHandoffPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const store = await handle.read<ClaimsStore>({ storeId: STORE_ID, key: 'root' });
        if (!store) {
          throw new Error(`claims_handoff: no claims store`);
        }
        const claim = store.claims[payload.issueId];
        if (!claim) {
          throw new Error(`claims_handoff: issue '${payload.issueId}' is not claimed`);
        }
        if (formatClaimant(claim.claimant) !== formatClaimant(payload.from)) {
          throw new Error(`claims_handoff: only the current claimant can request handoff`);
        }

        const now = new Date().toISOString();
        claim.status = 'handoff-pending';
        claim.statusChangedAt = now;
        claim.handoffTo = payload.to;
        claim.handoffReason = payload.reason;
        claim.progress = payload.progress ?? 0;

        store.claims[payload.issueId] = claim;

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [],
      cacheScope: 'store',
    },
  );
