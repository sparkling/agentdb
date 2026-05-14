// charter: dispatch
// claims_status mutation handler (ADR-0180 Phase 5).
// Updates a claim's status (active/paused/blocked/review-requested/completed)
// and optional note + progress. The 'stealable' transition has its own
// dedicated handler (claims_mark-stealable).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';
import type { ClaimsStore, ClaimStatus } from './claim';

export interface ClaimsStatusPayload {
  readonly issueId: string;
  readonly status: ClaimStatus;
  readonly note?: string;
  readonly progress?: number;
}

const STORE_ID = 'claims' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port cli `claims_status` body.
export const claimsStatusHandler: GuardedWrite<ClaimsStatusPayload> =
  registerMutationHandler<ClaimsStatusPayload>(
    'claims_status',
    async (ctx: MutationContext<false>, payload: ClaimsStatusPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const store = await handle.read<ClaimsStore>({ storeId: STORE_ID, key: 'root' });
        if (!store) {
          throw new Error(`claims_status: no claims store`);
        }
        const claim = store.claims[payload.issueId];
        if (!claim) {
          throw new Error(`claims_status: issue '${payload.issueId}' is not claimed`);
        }

        const now = new Date().toISOString();
        claim.status = payload.status;
        claim.statusChangedAt = now;
        if (payload.status === 'blocked') {
          claim.blockReason = payload.note;
        }
        if (payload.progress !== undefined) {
          claim.progress = Math.min(100, Math.max(0, payload.progress));
        }

        store.claims[payload.issueId] = claim;

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [],
      cacheScope: 'store',
    },
  );
