// charter: dispatch
// claims_rebalance mutation handler (ADR-0180 Phase 5).
// Suggests or applies load-rebalancing moves across agents. With `dryRun=true`
// returns suggestions without mutating; with `dryRun=false` reassigns claims
// from overloaded to underloaded agents of the same type.
//
// Note: the cli surface returns rich metrics + suggestions to the caller.
// Mutation handlers are void-returning per archivist contract; the metrics
// surface stays at the cli layer (the cli wrapper computes them post-dispatch
// or pre-dispatch and returns them). Body below covers the mutation portion only.

import { registerMutationHandler } from '../../registration.js';
import type {
  GuardedWrite,
  MutationContext,
  StoreId,
} from '../../index.js';
import type { ClaimsStore, IssueClaim } from './claim.js';
import { rebalanceInvariants } from '../../invariants/claims/rebalance.js';

export interface ClaimsRebalancePayload {
  readonly dryRun?: boolean;
  readonly targetUtilization?: number;
}

const STORE_ID = 'claims' as StoreId;

interface AgentLoad {
  agentId: string;
  agentType: string;
  claims: IssueClaim[];
}

// TODO(ADR-0180 Phase 5 wire-up): port cli `claims_rebalance` body.
// Cli wrapper computes suggestions + metrics for the response; handler only
// applies the chosen moves when dryRun=false.
export const claimsRebalanceHandler: GuardedWrite<ClaimsRebalancePayload> =
  registerMutationHandler<ClaimsRebalancePayload>(
    'claims_rebalance',
    async (ctx: MutationContext<false>, payload: ClaimsRebalancePayload): Promise<void> => {
      const dryRun = payload.dryRun !== false;
      if (dryRun) {
        return;
      }
      const targetUtilization = payload.targetUtilization ?? 0.7;
      const maxClaims = 5;

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const store = await handle.read<ClaimsStore>({ storeId: STORE_ID, key: 'root' });
        if (!store) {
          throw new Error(`claims_rebalance: no claims store`);
        }

        const claims = Object.values(store.claims);
        const agentLoads = new Map<string, AgentLoad>();
        for (const claim of claims) {
          if (claim.claimant.type !== 'agent' || !claim.claimant.agentId) continue;
          const key = claim.claimant.agentId;
          if (!agentLoads.has(key)) {
            agentLoads.set(key, {
              agentId: key,
              agentType: claim.claimant.agentType ?? 'unknown',
              claims: [],
            });
          }
          agentLoads.get(key)!.claims.push(claim);
        }

        const loads = Array.from(agentLoads.values());
        const overloaded = loads.filter(
          (l) => l.claims.length > maxClaims * targetUtilization * 1.5,
        );
        const underloaded = loads.filter(
          (l) => l.claims.length < maxClaims * targetUtilization * 0.5,
        );

        for (const over of overloaded) {
          const movable = over.claims
            .filter((c) => c.progress < 25 && c.status === 'active')
            .slice(0, over.claims.length - Math.ceil(maxClaims * targetUtilization));
          for (const claim of movable) {
            const target = underloaded.find(
              (u) => u.agentType === over.agentType && u.claims.length < maxClaims,
            );
            if (target) {
              claim.claimant = {
                type: 'agent',
                agentId: target.agentId,
                agentType: target.agentType,
              };
              claim.statusChangedAt = new Date().toISOString();
              store.claims[claim.issueId] = claim;
              target.claims.push(claim);
            }
          }
        }

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: rebalanceInvariants,
      cacheScope: 'store',
    },
  );
