// charter: dispatch
// ADR-0184 Wave 3 — weighted strategy handler body. Ports cli `hive-mind-tools.ts`
// `hive-mind_consensus` Weighted branches verbatim (ADR-0119 T1):
//   propose: state.queen guard → MissingQueenForWeightedConsensusError('propose');
//            threshold via calculateRequiredVotes('weighted', N) = max(0, N-1) + QUEEN_WEIGHT
//   vote:    state.queen guard at vote-time (covers abdication between
//            propose and vote); tryResolveProposal(proposal, N, queen.agentId)
//            invokes the weighted branch + weighted-deadlock arithmetic;
//            weightedTally used for history-row telemetry on resolution
//   status:  shared reconcile + ADR-0131 (T12) auto-status-transition.
//            Per Wave 3 DA Concern 3 resolution: queen-abdicated AT status time
//            (state.queen undefined when auto-transition fires) THROWS
//            MissingQueenForWeightedConsensusError('status-transition') rather
//            than recording a zeroed history-row tally — the failure mode is
//            real and distinct from any other path, and a silent fallback
//            would lose the "queen abdicated post-propose" signal in the
//            audit trail.
//   list:    no-op (parent dispatcher's withWrite scope is the audit boundary)
//
// Per ADR-0184 Wave 2 DA Concern 2: cli soft-`{action, error}` returns become
// typed throws here. Cli Wave 6 catches the typed errors and reshapes.

import type { MutationContext, SubstrateHandle } from '../../../index.js';
import type { HiveMindConsensusPayload } from '../consensus.js';
import {
  type ConsensusProposal,
  type ConsensusHistoryRow,
  RAFT_TIMEOUT_MS_DEFAULT,
  calculateRequiredVotes,
  DuplicateVoteError,
  ensureConsensusContainer,
  loadHiveStateFromHandle,
  MissingQueenForWeightedConsensusError,
  ProposalAlreadyFailedError,
  ProposalNotFoundError,
  reconcileFailedFromStatusKeys,
  saveHiveStateToHandle,
  tryResolveProposal,
  VoterIdRequiredError,
  weightedTally,
  WorkerAlreadyFailedError,
  workerMetaFor,
} from './_shared.js';

export async function handleWeightedConsensus(
  _ctx: MutationContext<false>,
  handle: SubstrateHandle,
  payload: HiveMindConsensusPayload,
): Promise<void> {
  const state = await loadHiveStateFromHandle(handle);
  if (!state) {
    throw new Error(
      'hive-mind_consensus.weighted: hive-mind state not initialized — run hive-mind_init first',
    );
  }
  const consensus = ensureConsensusContainer(state);
  const totalNodes = state.workers.length || 1;
  // state.queen accessed via loose-typed cast — HiveStateDoc declares queen
  // via index signature `[key: string]: unknown`. Matches HiveQueenRecord
  // (cli line 184): `agentId: string`. Width-narrowed to just the fields the
  // weighted handler touches (agentId for tally / dispatch).
  const queen = (state as { queen?: { agentId: string } }).queen;

  switch (payload.action) {
    case 'propose': {
      if (!queen) {
        throw new MissingQueenForWeightedConsensusError('propose');
      }
      const proposalId =
        payload.proposalId ??
        `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timeoutMs = payload.timeoutMs ?? RAFT_TIMEOUT_MS_DEFAULT;

      // Per ADR-0184 Wave 2 DA Axis (h): explicit `undefined` for
      // non-weighted fields so a prior proposal's stale field shape cannot
      // leak through `state.consensus.pending`.
      const proposal: ConsensusProposal = {
        proposalId,
        type: payload.type ?? 'general',
        value: payload.value,
        proposedBy: payload.voterId ?? 'system',
        proposedAt: new Date().toISOString(),
        votes: {},
        status: 'pending',
        strategy: 'weighted',
        timeoutAt: new Date(Date.now() + timeoutMs).toISOString(),
        // Non-weighted fields explicitly undefined.
        term: undefined,
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
      if (proposal.strategy !== 'weighted') {
        throw new Error(
          `hive-mind_consensus.vote: proposal ${proposalId} is ${proposal.strategy}, ` +
            `not weighted — caller supplied wrong strategy`,
        );
      }
      // Vote-time queen guard — covers abdication between propose and vote
      // (cli line 2225-2228).
      if (!queen) {
        throw new MissingQueenForWeightedConsensusError('vote');
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
          `hive-mind_consensus.vote: vote must be boolean for weighted, got ${typeof voteValue}`,
        );
      }

      // Weighted double-vote → reject. Cli quorum path (line 2440-2445)
      // applies to weighted via the same generic vote-not-in-proposal check.
      if (voterId in proposal.votes) {
        throw new DuplicateVoteError(voterId, proposalId, proposal.votes[voterId] ?? false);
      }

      proposal.votes[voterId] = voteValue;

      // tryResolveProposal invokes the weighted branch (cli line 722-749) via
      // the queenId argument — handles weighted tally + weighted-deadlock
      // arithmetic (queen 3x voting power per ADR-0119).
      const resolution = tryResolveProposal(proposal, totalNodes, queen.agentId);
      if (resolution !== null) {
        proposal.status = resolution;
        const tally = weightedTally(proposal, queen.agentId);
        const historyRow: ConsensusHistoryRow = {
          proposalId: proposal.proposalId,
          type: proposal.type,
          result: resolution,
          votes: { for: tally.votesFor, against: tally.votesAgainst },
          decidedAt: new Date().toISOString(),
          strategy: 'weighted',
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
      if (proposal.strategy !== 'weighted') {
        throw new Error(
          `hive-mind_consensus.status: proposal ${proposalId} is ${proposal.strategy}, ` +
            `not weighted — caller supplied wrong strategy`,
        );
      }

      // NOTE: cli line 2715 uses `Object.keys(proposal.votes).length < required`
      // for the auto-status-transition predicate. For weighted at N=3,
      // required = max(0, 3-1) + QUEEN_WEIGHT(3) = 5, but max raw-vote keys = 3
      // — the comparison is conceptually unit-mismatched (raw header count vs
      // weighted denominator) but BEHAVIOURALLY correct: an unresolved
      // weighted proposal at timeout necessarily has raw casts < weighted-
      // required, because tryResolveProposal would have moved the proposal to
      // approved/rejected if either weighted side hit the threshold. Verbatim
      // port preserves cli behaviour; the cli-alignment follow-up tracks the
      // unit-mismatch separately from this ADR.
      const required = calculateRequiredVotes('weighted', totalNodes);
      let mutated = reconciled;

      if (
        proposal.timeoutAt &&
        Date.now() >= new Date(proposal.timeoutAt).getTime() &&
        proposal.status === 'pending' &&
        Object.keys(proposal.votes).length < required
      ) {
        // Per Wave 3 DA Concern 3 resolution: queen-abdicated at status time
        // (state.queen undefined when auto-transition fires) THROWS rather
        // than recording a zeroed history-row tally. The audit trail would
        // otherwise lose the "queen abdicated post-propose" signal — and the
        // caller cannot distinguish "queen voted, history reset" from
        // "queen abdicated, tally zeroed" without the throw.
        if (!queen) {
          throw new MissingQueenForWeightedConsensusError('status-transition');
        }

        const absentVoters = state.workers.filter(
          (workerId) => !(workerId in proposal.votes),
        );
        const tally = weightedTally(proposal, queen.agentId);

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
            votes: { for: tally.votesFor, against: tally.votesAgainst },
            decidedAt: new Date().toISOString(),
            strategy: 'weighted',
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
      // Read-only enumeration; parent dispatcher's withWrite scope is the
      // audit boundary. No write needed.
      return;
    }

    default: {
      const _exhaustive: never = payload;
      throw new Error(
        `hive-mind_consensus.weighted: unknown action ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}
