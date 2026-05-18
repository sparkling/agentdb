// charter: dispatch
// ADR-0184 Wave 2 — raft strategy handler body. Ports cli `hive-mind-tools.ts`
// `hive-mind_consensus` Raft branches verbatim (ADR-0117):
//   propose: single-pending-proposal-per-term guard; floor(N/2)+1 threshold;
//            timeoutAt = now + (timeoutMs ?? 30000); term defaulted from
//            state.queen?.term ?? 1
//   vote:    same shared guards + double-vote → RaftVoteChangeError (no
//            byzantine path); tryResolveProposal; resolution → history
//   status:  reconcile + ADR-0131 auto-status-transition + history check
//   list:    no-op (parent dispatcher's withWrite scope is the audit boundary)
//
// Per ADR-0184 Wave 2 DA Concern 2: cli soft-`{action, error}` returns become
// typed throws here. Cli Wave 6 catches RaftTermCollisionError / RaftVoteChangeError
// and reshapes into the `{action, error, existingProposalId, term}` envelope.

import type { MutationContext, SubstrateHandle } from '../../../index.js';
import type { HiveMindConsensusPayload } from '../consensus.js';
import {
  type ConsensusProposal,
  type ConsensusHistoryRow,
  RAFT_TIMEOUT_MS_DEFAULT,
  calculateRequiredVotes,
  ensureConsensusContainer,
  loadHiveStateFromHandle,
  ProposalAlreadyFailedError,
  ProposalNotFoundError,
  RaftTermCollisionError,
  RaftVoteChangeError,
  reconcileFailedFromStatusKeys,
  saveHiveStateToHandle,
  tryResolveProposal,
  VoterIdRequiredError,
  WorkerAlreadyFailedError,
  workerMetaFor,
} from './_shared.js';

export async function handleRaftConsensus(
  _ctx: MutationContext<false>,
  handle: SubstrateHandle,
  payload: HiveMindConsensusPayload,
): Promise<void> {
  const state = await loadHiveStateFromHandle(handle);
  if (!state) {
    throw new Error(
      'hive-mind_consensus.raft: hive-mind state not initialized — run hive-mind_init first',
    );
  }
  const consensus = ensureConsensusContainer(state);
  const totalNodes = state.workers.length || 1;
  // cli reads state.queen?.term ?? 1 (cli line 2069). Treat state.queen as a
  // loosely-typed shape since HiveStateDoc declares queen via index signature.
  const queenTerm = (() => {
    const q = (state as { queen?: { term?: number } }).queen;
    return typeof q?.term === 'number' ? q.term : 1;
  })();

  switch (payload.action) {
    case 'propose': {
      const term = payload.term ?? queenTerm;
      // Single-pending-per-term guard (cli line 2077-2089). The cli soft-
      // returns `{action, error, existingProposalId, term}`; archivist throws
      // RaftTermCollisionError carrying both pieces so Wave 6 cli can reshape.
      const existingTermProposal = consensus.pending.find(
        (p) => p.strategy === 'raft' && p.term === term && p.status === 'pending',
      );
      if (existingTermProposal) {
        throw new RaftTermCollisionError(term, existingTermProposal.proposalId);
      }

      const proposalId =
        payload.proposalId ??
        `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timeoutMs = payload.timeoutMs ?? RAFT_TIMEOUT_MS_DEFAULT;

      const proposal: ConsensusProposal = {
        proposalId,
        type: payload.type ?? 'general',
        value: payload.value,
        proposedBy: payload.voterId ?? 'system',
        proposedAt: new Date().toISOString(),
        votes: {},
        status: 'pending',
        strategy: 'raft',
        term,
        timeoutAt: new Date(Date.now() + timeoutMs).toISOString(),
        // Explicit `undefined` for non-raft fields per ADR-0184 Wave 2 DA
        // Axis (h) — prevent stale-field leakage across strategies.
        quorumPreset: undefined,
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
      if (proposal.strategy !== 'raft') {
        throw new Error(
          `hive-mind_consensus.vote: proposal ${proposalId} is ${proposal.strategy}, ` +
            `not raft — caller supplied wrong strategy`,
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
          `hive-mind_consensus.vote: vote must be boolean for raft, got ${typeof voteValue}`,
        );
      }

      // Raft double-vote: any prior vote → reject. Cli line 2430-2438. Same-
      // value re-submission and value-change both throw RaftVoteChangeError.
      if (voterId in proposal.votes) {
        throw new RaftVoteChangeError(voterId, proposal.term);
      }

      proposal.votes[voterId] = voteValue;
      const votesFor = Object.values(proposal.votes).filter((v) => v).length;
      const votesAgainst = Object.values(proposal.votes).filter((v) => !v).length;

      const resolution = tryResolveProposal(proposal, totalNodes);
      if (resolution !== null) {
        proposal.status = resolution;
        const historyRow: ConsensusHistoryRow = {
          proposalId: proposal.proposalId,
          type: proposal.type,
          result: resolution,
          votes: { for: votesFor, against: votesAgainst },
          decidedAt: new Date().toISOString(),
          strategy: 'raft',
          term: proposal.term,
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
      if (proposal.strategy !== 'raft') {
        throw new Error(
          `hive-mind_consensus.status: proposal ${proposalId} is ${proposal.strategy}, ` +
            `not raft — caller supplied wrong strategy`,
        );
      }

      const required = calculateRequiredVotes('raft', totalNodes);
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
            strategy: 'raft',
            term: proposal.term,
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
        `hive-mind_consensus.raft: unknown action ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}
