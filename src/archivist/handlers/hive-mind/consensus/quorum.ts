// charter: dispatch
// ADR-0184 Wave 2 — quorum strategy handler body. Ports cli `hive-mind-tools.ts`
// `hive-mind_consensus` Quorum branches verbatim:
//   propose: `quorumPreset` defaulted to 'majority'; threshold via
//            `calculateRequiredVotes('quorum', N, preset)`
//   vote:    shared guards; double-vote → DuplicateVoteError; tryResolveProposal
//            (handles `unanimous` fast-reject when any against-vote arrives)
//   status:  reconcile + ADR-0131 auto-status-transition + history check
//   list:    no-op (parent dispatcher's withWrite scope is the audit boundary)
//
// Per ADR-0184 Wave 2 DA Concern 2: cli soft `{action, error}` returns become
// typed throws. Wave 6 cli catches DuplicateVoteError and reshapes.

import type { MutationContext, SubstrateHandle } from '../../../index.js';
import type { HiveMindConsensusPayload } from '../consensus.js';
import {
  type ConsensusProposal,
  type ConsensusHistoryRow,
  type QuorumPreset,
  RAFT_TIMEOUT_MS_DEFAULT,
  calculateRequiredVotes,
  DuplicateVoteError,
  ensureConsensusContainer,
  loadHiveStateFromHandle,
  ProposalAlreadyFailedError,
  ProposalNotFoundError,
  reconcileFailedFromStatusKeys,
  saveHiveStateToHandle,
  tryResolveProposal,
  VoterIdRequiredError,
  WorkerAlreadyFailedError,
  workerMetaFor,
} from './_shared.js';

export async function handleQuorumConsensus(
  _ctx: MutationContext<false>,
  handle: SubstrateHandle,
  payload: HiveMindConsensusPayload,
): Promise<void> {
  const state = await loadHiveStateFromHandle(handle);
  if (!state) {
    throw new Error(
      'hive-mind_consensus.quorum: hive-mind state not initialized — run hive-mind_init first',
    );
  }
  const consensus = ensureConsensusContainer(state);
  const totalNodes = state.workers.length || 1;

  switch (payload.action) {
    case 'propose': {
      const proposalId =
        payload.proposalId ??
        `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const quorumPreset: QuorumPreset = payload.quorumPreset ?? 'majority';
      const timeoutMs = payload.timeoutMs ?? RAFT_TIMEOUT_MS_DEFAULT;

      const proposal: ConsensusProposal = {
        proposalId,
        type: payload.type ?? 'general',
        value: payload.value,
        proposedBy: payload.voterId ?? 'system',
        proposedAt: new Date().toISOString(),
        votes: {},
        status: 'pending',
        strategy: 'quorum',
        quorumPreset,
        timeoutAt: new Date(Date.now() + timeoutMs).toISOString(),
        // Explicit `undefined` per ADR-0184 Wave 2 DA Axis (h).
        term: undefined,
        byzantineVoters: undefined,
        gossipRound: undefined,
        lastVoteChangedRound: undefined,
        totalNodes: undefined,
        currentRoundBroadcastSet: undefined,
        roundTimeoutMs: undefined,
        roundStartedAt: undefined,
        crdtState: undefined,
        crdtExpectedVoters: undefined,
      };

      consensus.pending.push(proposal);
      await saveHiveStateToHandle(handle, state);
      return;
    }

    case 'vote': {
      reconcileFailedFromStatusKeys(state);

      const proposalId = payload.proposalId;
      const historicalRow = consensus.history.find(
        (h) => h.proposalId === proposalId,
      );
      if (historicalRow) {
        throw new ProposalAlreadyFailedError(proposalId, historicalRow.result);
      }

      const proposal = consensus.pending.find((p) => p.proposalId === proposalId);
      if (!proposal) {
        throw new ProposalNotFoundError(proposalId, 'vote');
      }
      if (proposal.strategy !== 'quorum') {
        throw new Error(
          `hive-mind_consensus.vote: proposal ${proposalId} is ${proposal.strategy}, ` +
            `not quorum — caller supplied wrong strategy`,
        );
      }

      const voterId = payload.voterId;
      if (!voterId) {
        throw new VoterIdRequiredError();
      }

      const voterMeta = workerMetaFor(state, voterId);
      if (voterMeta.failedAt !== null) {
        throw new WorkerAlreadyFailedError(voterId, voterMeta.failedAt);
      }

      const voteValue = payload.vote;
      if (typeof voteValue !== 'boolean') {
        throw new Error(
          `hive-mind_consensus.vote: vote must be boolean for quorum, got ${typeof voteValue}`,
        );
      }

      // Quorum double-vote → reject both same-value and value-change.
      // Cli line 2440-2445 (same-vote soft-error) + 2398-2402 (any prior vote
      // route falls through to the generic quorum reject branch).
      if (voterId in proposal.votes) {
        throw new DuplicateVoteError(voterId, proposalId, proposal.votes[voterId] ?? false);
      }

      proposal.votes[voterId] = voteValue;
      const votesFor = Object.values(proposal.votes).filter((v) => v).length;
      const votesAgainst = Object.values(proposal.votes).filter((v) => !v).length;

      // tryResolveProposal handles unanimous fast-reject + deadlock detection.
      const resolution = tryResolveProposal(proposal, totalNodes);
      if (resolution !== null) {
        proposal.status = resolution;
        const historyRow: ConsensusHistoryRow = {
          proposalId: proposal.proposalId,
          type: proposal.type,
          result: resolution,
          votes: { for: votesFor, against: votesAgainst },
          decidedAt: new Date().toISOString(),
          strategy: 'quorum',
        };
        consensus.history.push(historyRow);
        consensus.pending = consensus.pending.filter(
          (p) => p.proposalId !== proposal.proposalId,
        );
      }
      await saveHiveStateToHandle(handle, state);
      return;
    }

    case 'status': {
      const reconciled = reconcileFailedFromStatusKeys(state);

      const proposalId = payload.proposalId;
      const proposal = consensus.pending.find((p) => p.proposalId === proposalId);
      if (!proposal) {
        const historical = consensus.history.find((h) => h.proposalId === proposalId);
        if (historical) {
          if (reconciled) await saveHiveStateToHandle(handle, state);
          return;
        }
        throw new ProposalNotFoundError(proposalId, 'status');
      }
      if (proposal.strategy !== 'quorum') {
        throw new Error(
          `hive-mind_consensus.status: proposal ${proposalId} is ${proposal.strategy}, ` +
            `not quorum — caller supplied wrong strategy`,
        );
      }

      const required = calculateRequiredVotes(
        'quorum',
        totalNodes,
        proposal.quorumPreset,
      );
      let mutated = reconciled;

      if (
        proposal.timeoutAt &&
        Date.now() >= new Date(proposal.timeoutAt).getTime() &&
        proposal.status === 'pending' &&
        Object.keys(proposal.votes).length < required
      ) {
        const absentVoters = state.workers.filter(
          (workerId) => !(workerId in proposal.votes),
        );
        const votesFor = Object.values(proposal.votes).filter((v) => v).length;
        const votesAgainst = Object.values(proposal.votes).filter((v) => !v).length;

        proposal.status = 'failed-quorum-not-reached';
        proposal.absentVoters = absentVoters;

        const alreadyInHistory = consensus.history.some(
          (h) => h.proposalId === proposal.proposalId,
        );
        if (!alreadyInHistory) {
          const historyRow: ConsensusHistoryRow = {
            proposalId: proposal.proposalId,
            type: proposal.type,
            result: 'failed-quorum-not-reached',
            votes: { for: votesFor, against: votesAgainst },
            decidedAt: new Date().toISOString(),
            strategy: 'quorum',
            absentVoters,
          };
          consensus.history.push(historyRow);
        }
        consensus.pending = consensus.pending.filter(
          (p) => p.proposalId !== proposal.proposalId,
        );
        mutated = true;
      }

      if (mutated) await saveHiveStateToHandle(handle, state);
      return;
    }

    case 'list': {
      return;
    }

    default: {
      const _exhaustive: never = payload;
      throw new Error(
        `hive-mind_consensus.quorum: unknown action ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}
