// charter: dispatch
// coordination_consensus mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<CoordinationConsensusPayload>` so every consensus
// transition (status / propose / vote / commit) flows through the archivist's
// audit-chain (intent → applied | rejected) with guard verdicts + invariant
// verdicts recorded.
//
// Distinction from `hive-mind_consensus` (handlers/hive-mind/consensus.ts):
//   - `hive-mind_consensus` mutates `state.consensus` under `hive-state.json` —
//     the hive's worker-coordinated proposals (BFT/Raft/Quorum/Gossip/CRDT).
//   - `coordination_consensus` (this handler) mutates `store.consensus` under
//     `.claude-flow/coordination/store.json` — the topology-level consensus
//     proposals (BFT/Raft/Quorum only at the cli surface). Different store,
//     different STORE_ID, same audit-chain shape.
//
// Why mixed-mode actions register as ONE mutation handler:
//   - status:  reads `consensus.pending` or `consensus.history` lookup. Pure
//              read shape (no `saveCoordStore`), but flows through the mutation
//              registration so there is exactly one registry entry per cli tool
//              name (consensus.ts precedent).
//   - propose: mutates `consensus.pending` — new proposal record. Raft-strategy
//              one-pending-per-term invariant enforced inline (today as a
//              `success: false` early return; should become a typed invariant
//              violation under Phase 5 wire-up per `feedback-no-fallbacks`).
//   - vote:    mutates `consensus.pending[*].votes` and (on resolution) moves
//              the proposal to `consensus.history` with byzantine-voter
//              detection for BFT.
//   - commit:  no-op confirmation against `consensus.history`. Pure read shape
//              today (returns success/failure without mutation), but flows
//              through the mutation registration alongside the other actions.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/coordination-tools.ts`
// `coordination_consensus` handler — load → action-switch → mutate →
// `saveCoordStore`. The cli callsite stays in place until the dispatch boundary
// is wired through cli; this file establishes the registration shape.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/coordination/store.json` (consensus subtree) may mutate. The
// underlying primitive is `makeFsJsonSubstrate` (substrates/fs-json-store.ts),
// shared with the other five `coordination_*` mutation handlers.

import { registerMutationHandler } from '../../registration.js';
import type { MutationContext } from '../../mutation-context.js';
import type { GuardedWrite, StoreId } from '../../types.js';
import { consensusInvariants } from '../../invariants/coordination/consensus.js';
import {
  COORD_STORE_KEY,
  calcRequiredVotes,
  loadCoordStore,
  type CoordConsensusProposal,
  type CoordConsensusState,
  type CoordinationStore,
} from './shared.js';

/** Consensus strategy at the coordination surface — matches the CLI inputSchema
 *  enum (line 505 of coordination-tools.ts). Narrower than hive-mind's set
 *  (no gossip/crdt/weighted at this surface). */
export type CoordinationConsensusStrategy = 'bft' | 'raft' | 'quorum';

/** Quorum threshold preset — only meaningful for `strategy: 'quorum'`. */
export type CoordinationQuorumPreset = 'unanimous' | 'majority' | 'supermajority';

/** Action discriminator — mirrors the cli tool's inputSchema.action enum. */
export type CoordinationConsensusAction = 'status' | 'propose' | 'vote' | 'commit';

/** Vote payload — `'accept'` maps to internal `true`, `'reject'` to `false`. */
export type CoordinationVote = 'accept' | 'reject';

/**
 * Mutation payload mirroring the CLI tool's `coordination_consensus` input
 * shape (coordination-tools.ts inputSchema lines 499-507). All fields optional
 * except as required by action; the cli's defaults are `action='status'`,
 * `strategy='raft'`, `quorumPreset='majority'`, `term=1`.
 */
export interface CoordinationConsensusPayload {
  readonly action?: CoordinationConsensusAction;
  readonly proposal?: unknown;
  readonly proposalId?: string;
  readonly vote?: CoordinationVote;
  readonly voterId?: string;
  readonly strategy?: CoordinationConsensusStrategy;
  readonly quorumPreset?: CoordinationQuorumPreset;
  readonly term?: number;
}

const STORE_ID = 'coordination_consensus' as StoreId;

// Ports the action-switch body of coordination-tools.ts `coordination_consensus`.
// The cli's `loadCoordStore → init store.consensus if missing → action-switch →
// saveCoordStore` collapses to one `ctx.substrate.withWrite`. `status` and
// `commit` are pure reads in the cli (no `saveCoordStore`); `propose` and `vote`
// mutate `store.consensus`.
//
// Divergence from the cli (`feedback-no-fallbacks`): the cli signals its
// correctness gates with `success: false` early returns. This handler returns
// `void`, so those become typed throws — making the audit chain record a
// rejected intent rather than a silently-discarded one:
//   1. Raft one-pending-per-term — a second proposal for the same `(raft, term)`
//      throws instead of returning `success: false`.
//   2. BFT byzantine-voter detection — a conflicting vote (intra- or
//      cross-proposal) still records the voter on `byzantineVoters[]` AND
//      persists that record, then throws so the rejection is audited.
//   3. vote on a missing proposal / missing voterId — throws.
export const consensusCoordinationHandler: GuardedWrite<CoordinationConsensusPayload> =
  registerMutationHandler<CoordinationConsensusPayload>(
    'coordination_consensus',
    async (ctx: MutationContext<false>, payload: CoordinationConsensusPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<CoordinationStore>({
          storeId: STORE_ID,
          key: COORD_STORE_KEY,
        });
        const store: CoordinationStore = current ?? loadCoordStore();
        const action: CoordinationConsensusAction = payload.action ?? 'status';
        const strategy: CoordinationConsensusStrategy = payload.strategy ?? 'raft';
        const nodeCount = Object.keys(store.nodes).length || 1;

        if (!store.consensus) {
          store.consensus = { pending: [], history: [] };
        }
        const consensus: CoordConsensusState = store.consensus;

        // `status` / `commit` are pure reads at the cli surface — no write.
        if (action === 'status' || action === 'commit') {
          return;
        }

        if (action === 'propose') {
          const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const quorumPreset = payload.quorumPreset ?? 'majority';
          const term = payload.term ?? 1;

          // Raft: one pending proposal per term.
          if (strategy === 'raft') {
            const existing = consensus.pending.find(
              (p) => p.strategy === 'raft' && p.term === term,
            );
            if (existing) {
              throw new Error(
                `coordination_consensus: Raft term ${term} already has pending proposal ` +
                `'${existing.proposalId}'`,
              );
            }
          }

          const proposal: CoordConsensusProposal = {
            proposalId,
            type: 'coordination',
            proposal: payload.proposal,
            proposedBy: payload.voterId ?? 'system',
            proposedAt: new Date().toISOString(),
            votes: {},
            status: 'pending',
            strategy,
            term: strategy === 'raft' ? term : undefined,
            quorumPreset: strategy === 'quorum' ? quorumPreset : undefined,
            byzantineVoters: strategy === 'bft' ? [] : undefined,
          };
          consensus.pending.push(proposal);
          await handle.write({ storeId: STORE_ID, key: COORD_STORE_KEY, payload: store });
          return;
        }

        if (action === 'vote') {
          const p = consensus.pending.find((x) => x.proposalId === payload.proposalId);
          if (!p) {
            throw new Error(
              `coordination_consensus: proposal '${String(payload.proposalId)}' not found ` +
              'or already resolved',
            );
          }

          const voterId = payload.voterId;
          if (voterId === undefined || voterId.length === 0) {
            throw new Error('coordination_consensus: voterId is required to vote');
          }

          const voteValue = payload.vote === 'accept';
          const pStrategy = p.strategy || 'raft';
          const required = calcRequiredVotes(pStrategy, nodeCount, p.quorumPreset);

          // Double-vote prevention.
          if (voterId in p.votes) {
            if (pStrategy === 'bft' && p.votes[voterId] !== voteValue) {
              if (!p.byzantineVoters) p.byzantineVoters = [];
              if (!p.byzantineVoters.includes(voterId)) p.byzantineVoters.push(voterId);
              delete p.votes[voterId];
              await handle.write({ storeId: STORE_ID, key: COORD_STORE_KEY, payload: store });
              throw new Error(
                `coordination_consensus: Byzantine behaviour — voter '${voterId}' attempted a ` +
                'conflicting vote on the same proposal; vote invalidated',
              );
            }
            throw new Error(
              `coordination_consensus: voter '${voterId}' has already voted on this proposal`,
            );
          }

          // BFT cross-proposal conflict check.
          if (pStrategy === 'bft') {
            for (const other of consensus.pending) {
              if (other.proposalId === p.proposalId) continue;
              if (voterId in other.votes && other.votes[voterId] !== voteValue) {
                if (!p.byzantineVoters) p.byzantineVoters = [];
                if (!p.byzantineVoters.includes(voterId)) p.byzantineVoters.push(voterId);
                await handle.write({ storeId: STORE_ID, key: COORD_STORE_KEY, payload: store });
                throw new Error(
                  `coordination_consensus: Byzantine behaviour — voter '${voterId}' cast ` +
                  'conflicting votes across proposals',
                );
              }
            }
          }

          p.votes[voterId] = voteValue;

          const votesFor = Object.values(p.votes).filter((v) => v).length;
          const votesAgainst = Object.values(p.votes).filter((v) => !v).length;

          let resolved = false;
          let result: string | undefined;
          if (votesFor >= required) {
            resolved = true;
            result = 'approved';
          } else if (votesAgainst >= required) {
            resolved = true;
            result = 'rejected';
          } else if (
            pStrategy === 'quorum' &&
            p.quorumPreset === 'unanimous' &&
            votesAgainst > 0
          ) {
            resolved = true;
            result = 'rejected';
          }

          if (resolved && result) {
            p.status = result;
            consensus.history.push({
              proposalId: p.proposalId,
              result,
              votes: { for: votesFor, against: votesAgainst },
              decidedAt: new Date().toISOString(),
              strategy: pStrategy,
              term: p.term,
              byzantineDetected: p.byzantineVoters?.length ? p.byzantineVoters : undefined,
            });
            consensus.pending = consensus.pending.filter(
              (x) => x.proposalId !== p.proposalId,
            );
          }

          await handle.write({ storeId: STORE_ID, key: COORD_STORE_KEY, payload: store });
          return;
        }

        throw new Error(`coordination_consensus: unknown action '${String(action)}'`);
      });
    },
    {
      invariants: consensusInvariants,
      cacheScope: 'global',
    },
  );
