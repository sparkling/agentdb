// charter: dispatch
// claims_claim mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<ClaimsClaimPayload>` so every claim transitions
// through the archivist's audit chain with the substrate's O_EXCL lock providing
// the cross-process mutual exclusion that ADR-0094 P9 demands.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/claims-tools.ts` `claims_claim`
// handler — wrapped its read-check-write in `withClaimsLock` (POSIX O_EXCL
// lockfile). The substrate's `withWrite` subsumes that primitive; cli callsites
// stay in place until Phase 7+ removes the legacy path.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

export interface Claimant {
  readonly type: 'human' | 'agent';
  readonly userId?: string;
  readonly name?: string;
  readonly agentId?: string;
  readonly agentType?: string;
}

export type ClaimStatus =
  | 'active'
  | 'paused'
  | 'handoff-pending'
  | 'review-requested'
  | 'blocked'
  | 'stealable'
  | 'completed';

export type StealReason = 'overloaded' | 'stale' | 'blocked-timeout' | 'voluntary';

export interface IssueClaim {
  readonly issueId: string;
  claimant: Claimant;
  readonly claimedAt: string;
  status: ClaimStatus;
  statusChangedAt: string;
  expiresAt?: string;
  handoffTo?: Claimant;
  handoffReason?: string;
  blockReason?: string;
  progress: number;
  context?: string;
}

export interface StealableInfo {
  reason: StealReason;
  stealableAt: string;
  preferredTypes?: ReadonlyArray<string>;
  progress: number;
  context?: string;
}

export interface ClaimsStore {
  claims: Record<string, IssueClaim>;
  stealable: Record<string, StealableInfo>;
  contests: Record<string, { originalClaimant: Claimant; contestedAt: string; reason: string }>;
}

export interface ClaimsClaimPayload {
  readonly issueId: string;
  readonly claimant: Claimant;
  readonly context?: string;
}

const STORE_ID = 'claims' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the cli `claims_claim` handler body
// here once the dispatch boundary is wired through cli. The cli's
// `withClaimsLock` collapses to `ctx.substrate.withWrite` because the
// substrate primitive owns the lock semantics. Body: read store, reject if
// `store.claims[issueId]` exists, mint claim with status='active', write back.
export const claimsClaimHandler: GuardedWrite<ClaimsClaimPayload> =
  registerMutationHandler<ClaimsClaimPayload>(
    'claims_claim',
    async (ctx: MutationContext<false>, payload: ClaimsClaimPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<ClaimsStore>({
          storeId: STORE_ID,
          key: 'root',
        });
        const store: ClaimsStore = current ?? { claims: {}, stealable: {}, contests: {} };

        if (store.claims[payload.issueId]) {
          throw new Error(
            `claims_claim: issue '${payload.issueId}' already claimed`,
          );
        }

        const now = new Date().toISOString();
        store.claims[payload.issueId] = {
          issueId: payload.issueId,
          claimant: payload.claimant,
          claimedAt: now,
          status: 'active',
          statusChangedAt: now,
          progress: 0,
          context: payload.context,
        };

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [],
      cacheScope: 'store',
    },
  );
