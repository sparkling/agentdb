// charter: dispatch
// claims_mark-stealable mutation handler (ADR-0180 Phase 5).
// Marks an existing claim as stealable by other agents (per ADR-016 workflow).
// Writes both `claims[issueId].status='stealable'` and `stealable[issueId]`
// metadata atomically inside a single substrate withWrite.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';
import type { ClaimsStore, StealReason } from './claim.js';

export interface ClaimsMarkStealablePayload {
  readonly issueId: string;
  readonly reason: StealReason;
  readonly preferredTypes?: ReadonlyArray<string>;
  readonly context?: string;
}

const STORE_ID = 'claims' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port cli `claims_mark-stealable` body.
export const claimsMarkStealableHandler: GuardedWrite<ClaimsMarkStealablePayload> =
  registerMutationHandler<ClaimsMarkStealablePayload>(
    'claims_mark-stealable',
    async (ctx: MutationContext<false>, payload: ClaimsMarkStealablePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const store = await handle.read<ClaimsStore>({ storeId: STORE_ID, key: 'root' });
        if (!store) {
          throw new Error(`claims_mark-stealable: no claims store`);
        }
        const claim = store.claims[payload.issueId];
        if (!claim) {
          throw new Error(`claims_mark-stealable: issue '${payload.issueId}' is not claimed`);
        }

        const now = new Date().toISOString();
        claim.status = 'stealable';
        claim.statusChangedAt = now;

        store.stealable[payload.issueId] = {
          reason: payload.reason,
          stealableAt: now,
          preferredTypes: payload.preferredTypes,
          progress: claim.progress,
          context: payload.context,
        };
        store.claims[payload.issueId] = claim;

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [],
      cacheScope: 'store',
    },
  );
