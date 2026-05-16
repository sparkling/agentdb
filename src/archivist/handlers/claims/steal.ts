// charter: dispatch
// claims_steal mutation handler (ADR-0180 Phase 5).
// Lets a new claimant take over a stealable issue. Honors `preferredTypes`
// on the stealable entry; rejects if the stealer's agentType is not in the
// allowed list. The substrate's O_EXCL lock guarantees that of N parallel
// steals against the same issue, exactly one succeeds.

import { registerMutationHandler } from '../../registration.js';
import type {
  GuardedWrite,
  MutationContext,
  StoreId,
} from '../../index.js';
import type { Claimant, ClaimsStore } from './claim.js';
import { stealInvariants } from '../../invariants/claims/steal.js';

export interface ClaimsStealPayload {
  readonly issueId: string;
  readonly stealer: Claimant;
}

const STORE_ID = 'claims' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port cli `claims_steal` body.
export const claimsStealHandler: GuardedWrite<ClaimsStealPayload> =
  registerMutationHandler<ClaimsStealPayload>(
    'claims_steal',
    async (ctx: MutationContext<false>, payload: ClaimsStealPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const store = await handle.read<ClaimsStore>({ storeId: STORE_ID, key: 'root' });
        if (!store) {
          throw new Error(`claims_steal: no claims store`);
        }
        const claim = store.claims[payload.issueId];
        const stealableInfo = store.stealable[payload.issueId];

        if (!claim) {
          throw new Error(`claims_steal: issue '${payload.issueId}' is not claimed`);
        }
        if (!stealableInfo) {
          throw new Error(`claims_steal: issue '${payload.issueId}' is not stealable`);
        }

        if (
          stealableInfo.preferredTypes &&
          stealableInfo.preferredTypes.length > 0 &&
          payload.stealer.type === 'agent' &&
          payload.stealer.agentType &&
          !stealableInfo.preferredTypes.includes(payload.stealer.agentType)
        ) {
          throw new Error(
            `claims_steal: stealer agentType '${payload.stealer.agentType}' not in preferredTypes`,
          );
        }

        const now = new Date().toISOString();
        claim.claimant = payload.stealer;
        claim.status = 'active';
        claim.statusChangedAt = now;
        claim.context = stealableInfo.context;

        delete store.stealable[payload.issueId];
        store.claims[payload.issueId] = claim;

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: stealInvariants,
      cacheScope: 'store',
    },
  );
