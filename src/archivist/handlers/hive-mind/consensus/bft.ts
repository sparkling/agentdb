// charter: dispatch
// ADR-0184 Wave 2 — bft strategy handler body. Ports cli `hive-mind-tools.ts`
// `hive-mind_consensus` BFT branches verbatim:
//   propose: floor(2N/3)+1 threshold, byzantineVoters: [], isThresholdBased
//   vote:    same-voter-conflict (in-proposal) + cross-proposal-conflict
//            Byzantine detection; flagged voter's vote deleted; tryResolveProposal
//   status:  reconcile + ADR-0131 auto-status-transition + history check
//   list:    no-op (parent dispatcher's withWrite scope is the audit boundary;
//            read-only enumeration is performed by Wave 6 cli post-dispatch)
//
// The parent dispatcher (../consensus.ts) normalises `byzantine → bft` at
// entry, so this handler treats `payload.strategy === 'bft'` as canonical and
// MUST NOT re-read or re-dispatch on `'byzantine'`.
//
// Per ADR-0184 Wave 2 DA Concern 2: cli soft-`{action, error}` returns become
// typed throws here (the archivist `Promise<void>` signature has no error-
// return path). Wave 6 cli flips catch these throws and reshape.
//
// Per ADR-0184 Wave 2 DA Axis (g): one `saveHiveStateToHandle` call per body
// (at the end of mutating paths) accumulates all in-memory mutations
// (reconcile + vote + auto-status-transition) into one substrate write =
// one audit entry per call.

import type { MutationContext, SubstrateHandle } from '../../../index.js';
import type { HiveMindConsensusPayload } from '../consensus.js';
import {
  type ConsensusProposal,
  type ConsensusHistoryRow,
  RAFT_TIMEOUT_MS_DEFAULT,
  calculateRequiredVotes,
  detectByzantineVoters,
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

export async function handleBftConsensus(
  _ctx: MutationContext<false>,
  handle: SubstrateHandle,
  payload: HiveMindConsensusPayload,
): Promise<void> {
  const state = await loadHiveStateFromHandle(handle);
  if (!state) {
    throw new Error(
      'hive-mind_consensus.bft: hive-mind state not initialized — run hive-mind_init first',
    );
  }
  const consensus = ensureConsensusContainer(state);
  const totalNodes = state.workers.length || 1;

  switch (payload.action) {
    case 'propose': {
      // Per ADR-0184 Wave 2 DA Concern 3: honour caller-pre-minted proposalId
      // when supplied (Wave 6 cli pre-mints to sidestep pre/post-snapshot race);
      // mint otherwise. id space `proposal-${Date.now()}-${rand}` per cli.
      const proposalId =
        payload.proposalId ??
        `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timeoutMs = payload.timeoutMs ?? RAFT_TIMEOUT_MS_DEFAULT;

      // Per ADR-0184 Wave 2 DA Axis (h): explicit `undefined` for
      // gossip/CRDT fields so a prior proposal's stale field shape cannot
      // leak through `state.consensus.pending`.
      const proposal: ConsensusProposal = {
        proposalId,
        type: payload.type ?? 'general',
        value: payload.value,
        proposedBy: payload.voterId ?? 'system',
        proposedAt: new Date().toISOString(),
        votes: {},
        status: 'pending',
        strategy: 'bft',
        byzantineVoters: [],
        timeoutAt: new Date(Date.now() + timeoutMs).toISOString(),
        term: undefined,
        quorumPreset: undefined,
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
      // §6 absence reconciliation BEFORE the vote-time guard (cli ~2178).
      reconcileFailedFromStatusKeys(state);

      const proposalId = payload.proposalId;
      // Historical row → terminal; throw per ADR-0131 §Specification.
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
      if (proposal.strategy !== 'bft') {
        // Defensive: caller routed a non-bft proposal to the bft handler.
        // The parent dispatcher routes on payload.strategy, not proposal.strategy
        // — a vote for a raft proposal supplied with strategy: 'bft' could
        // collide here. Throw rather than silently mutate the wrong strategy.
        throw new Error(
          `hive-mind_consensus.vote: proposal ${proposalId} is ${proposal.strategy}, ` +
            `not bft — caller supplied wrong strategy`,
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
          `hive-mind_consensus.vote: vote must be boolean for bft, got ${typeof voteValue}`,
        );
      }

      // Same-voter equivocation (in-proposal). Cli line 2410-2428.
      if (voterId in proposal.votes) {
        const previousVote = proposal.votes[voterId];
        if (previousVote === voteValue) {
          // Same vote re-submission — soft no-op in cli; archivist throws
          // per `feedback-no-fallbacks` discipline. Cli Wave 6 catches.
          throw new Error(
            `hive-mind_consensus.vote: voter ${voterId} already cast the same vote on proposal ${proposalId}`,
          );
        }
        // Conflicting vote from same voter in bft → Byzantine flag + drop vote.
        if (!proposal.byzantineVoters) proposal.byzantineVoters = [];
        if (!proposal.byzantineVoters.includes(voterId)) {
          proposal.byzantineVoters.push(voterId);
        }
        delete proposal.votes[voterId];
        await saveHiveStateToHandle(handle, state);
        return;
      }

      // Cross-proposal byzantine detection (cli line 2448-2470).
      const isByzantine = detectByzantineVoters(
        consensus.pending,
        proposal,
        voterId,
        voteValue,
      );
      if (isByzantine) {
        if (!proposal.byzantineVoters) proposal.byzantineVoters = [];
        if (!proposal.byzantineVoters.includes(voterId)) {
          proposal.byzantineVoters.push(voterId);
        }
        // Vote rejected — NOT recorded in proposal.votes.
        await saveHiveStateToHandle(handle, state);
        return;
      }

      // Record vote.
      proposal.votes[voterId] = voteValue;
      const votesFor = Object.values(proposal.votes).filter((v) => v).length;
      const votesAgainst = Object.values(proposal.votes).filter((v) => !v).length;

      // Resolve via shared helper (handles deadlock detection too).
      const resolution = tryResolveProposal(proposal, totalNodes);
      if (resolution !== null) {
        proposal.status = resolution;
        const historyRow: ConsensusHistoryRow = {
          proposalId: proposal.proposalId,
          type: proposal.type,
          result: resolution,
          votes: { for: votesFor, against: votesAgainst },
          decidedAt: new Date().toISOString(),
          strategy: 'bft',
          term: proposal.term,
          byzantineDetected:
            proposal.byzantineVoters && proposal.byzantineVoters.length > 0
              ? proposal.byzantineVoters
              : undefined,
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
      // §6 absence reconciliation BEFORE timing-driven mutations (cli ~2624).
      const reconciled = reconcileFailedFromStatusKeys(state);

      const proposalId = payload.proposalId;
      const proposal = consensus.pending.find((p) => p.proposalId === proposalId);
      if (!proposal) {
        const historical = consensus.history.find((h) => h.proposalId === proposalId);
        if (historical) {
          // Read-only fast path; persist only if reconcile mutated state.
          if (reconciled) await saveHiveStateToHandle(handle, state);
          return;
        }
        throw new ProposalNotFoundError(proposalId, 'status');
      }
      if (proposal.strategy !== 'bft') {
        throw new Error(
          `hive-mind_consensus.status: proposal ${proposalId} is ${proposal.strategy}, ` +
            `not bft — caller supplied wrong strategy`,
        );
      }

      const required = calculateRequiredVotes('bft', totalNodes);

      // ADR-0131 (T12) auto-status-transition: timeoutAt elapsed AND votes
      // still under required → flip to 'failed-quorum-not-reached', snapshot
      // absentVoters, move to history. Cli line 2710-2756.
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
            strategy: 'bft',
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
      // Read-only enumeration; no mutation. Single `handle.read` already done
      // at the top of this function; no write needed.
      return;
    }

    default: {
      // Exhaustiveness — discriminated union narrows action.
      const _exhaustive: never = payload;
      throw new Error(
        `hive-mind_consensus.bft: unknown action ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}
