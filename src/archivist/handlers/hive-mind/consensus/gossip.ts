// charter: dispatch
// ADR-0184 Wave 4 — gossip strategy handler body. Ports cli `hive-mind-tools.ts`
// `hive-mind_consensus` Gossip branches verbatim (ADR-0120 T2):
//   propose: gossipRound=0, lastVoteChangedRound=0, totalNodes snapshotted at
//            propose-time, currentRoundBroadcastSet=[], roundTimeoutMs from
//            input or GOSSIP_ROUND_TIMEOUT_MS_DEFAULT, roundStartedAt set;
//            threshold-strategy timeoutAt explicit undefined
//   vote:    6-step bookkeeping per cli line 2522-2588 — update
//            lastVoteChangedRound on tally change; select fanout(N)=ceil(log2 N)
//            deterministic targets via selectGossipTargets; update
//            currentRoundBroadcastSet; round-advance on coverage;
//            maybeAdvanceGossipRoundOnTimeout fallback; settleCheckGossip
//            resolution; hard-budget exhausted stays 'pending' with
//            gossipExhausted=true (per ADR-0184 Wave 4 DA Concern 2)
//   status:  maybeAdvanceGossipRoundOnTimeout (capture `advanced` flag) +
//            settleCheckGossip; resolves + moves to history if settled;
//            persists if just advanced
//   list:    no-op (parent dispatcher's withWrite scope is the audit boundary)
//
// ADR-0184 Open Follow-up #1 resolution: ADR-0131 auto-status-transition
// timing runs INLINE at the `status` action, not via a separate `status_settle`
// mutation. Rationale: gossip status is already a mutation action; half-split
// across strategies is worse than no split; no new action verb preserves cli
// interface verbatim. See commit message + ADR-0184 close-out amendment.

import type { MutationContext, SubstrateHandle } from '../../../index.js';
import type { HiveMindConsensusPayload } from '../consensus.js';
import {
  type ConsensusProposal,
  type ConsensusHistoryRow,
  GOSSIP_ROUND_TIMEOUT_MS_DEFAULT,
  ensureConsensusContainer,
  gossipFanout,
  loadHiveStateFromHandle,
  maybeAdvanceGossipRoundOnTimeout,
  ProposalAlreadyFailedError,
  ProposalNotFoundError,
  reconcileFailedFromStatusKeys,
  saveHiveStateToHandle,
  selectGossipTargets,
  settleCheckGossip,
  VoterIdRequiredError,
  WorkerAlreadyFailedError,
  workerMetaFor,
} from './_shared.js';

export async function handleGossipConsensus(
  _ctx: MutationContext<false>,
  handle: SubstrateHandle,
  payload: HiveMindConsensusPayload,
): Promise<void> {
  const state = await loadHiveStateFromHandle(handle);
  if (!state) {
    throw new Error(
      'hive-mind_consensus.gossip: hive-mind state not initialized — run hive-mind_init first',
    );
  }
  const consensus = ensureConsensusContainer(state);
  const totalNodes = state.workers.length || 1;

  switch (payload.action) {
    case 'propose': {
      const proposalId =
        payload.proposalId ??
        `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const roundTimeoutMs =
        payload.roundTimeoutMs ?? GOSSIP_ROUND_TIMEOUT_MS_DEFAULT;
      const proposalTotalNodes = Math.max(1, totalNodes);

      // Per ADR-0184 Wave 2 DA Axis (h): explicit `undefined` for non-gossip
      // fields so a prior proposal's stale field shape cannot leak through
      // `state.consensus.pending`. Threshold-strategy `timeoutAt` is
      // undefined for gossip (cli `isThresholdBased` excludes gossip per
      // line 2116-2128).
      const proposal: ConsensusProposal = {
        proposalId,
        type: payload.type ?? 'general',
        value: payload.value,
        proposedBy: payload.voterId ?? 'system',
        proposedAt: new Date().toISOString(),
        votes: {},
        status: 'pending',
        strategy: 'gossip',
        timeoutAt: undefined,
        // Gossip-specific fields.
        gossipRound: 0,
        lastVoteChangedRound: 0,
        totalNodes: proposalTotalNodes,
        currentRoundBroadcastSet: [],
        roundTimeoutMs,
        roundStartedAt: new Date().toISOString(),
        gossipExhausted: undefined,
        // Non-gossip fields explicitly undefined.
        term: undefined,
        quorumPreset: undefined,
        byzantineVoters: undefined,
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
      if (proposal.strategy !== 'gossip') {
        throw new Error(
          `hive-mind_consensus.vote: proposal ${proposalId} is ${proposal.strategy}, ` +
            `not gossip — caller supplied wrong strategy`,
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
          `hive-mind_consensus.vote: vote must be boolean for gossip, got ${typeof voteValue}`,
        );
      }

      // Cli line 2476-2477: snapshot prior tally for the lastVoteChangedRound
      // predicate. Captured BEFORE the vote-record write.
      const priorVotesFor = Object.values(proposal.votes).filter((v) => v).length;
      const priorVotesAgainst = Object.values(proposal.votes).filter((v) => !v).length;

      // Record the vote (cli line 2480).
      proposal.votes[voterId] = voteValue;

      // Recompute tally AFTER the write (gossip uses simple count, no queen
      // weighting).
      const votesFor = Object.values(proposal.votes).filter((v) => v).length;
      const votesAgainst = Object.values(proposal.votes).filter((v) => !v).length;

      // ── 6-step gossip propagation bookkeeping (cli line 2522-2588) ──
      const gossipTotalNodes = proposal.totalNodes ?? Math.max(1, totalNodes);
      const gossipRound = proposal.gossipRound ?? 0;

      // (1) Update lastVoteChangedRound if tally changed.
      const tallyChanged =
        votesFor !== priorVotesFor || votesAgainst !== priorVotesAgainst;
      if (tallyChanged) {
        proposal.lastVoteChangedRound = gossipRound;
      }

      // (2) Voter set = all known workers AT VOTE-TIME (anti-entropy:
      // late joiners admitted into candidate pool but totalNodes is fixed
      // per propose-time snapshot).
      const voterSet = [...state.workers];
      const fanoutSize = gossipFanout(gossipTotalNodes);
      const broadcastSet = new Set(proposal.currentRoundBroadcastSet ?? []);
      // (3) Always add the voter themselves to the round's broadcast set.
      broadcastSet.add(voterId);

      // Pick targets only when fanout > 0 (N > 1).
      if (fanoutSize > 0) {
        const targets = selectGossipTargets(
          proposal.proposalId,
          gossipRound,
          voterSet,
          broadcastSet,
          fanoutSize,
        );
        for (const t of targets) broadcastSet.add(t);
      }

      proposal.currentRoundBroadcastSet = [...broadcastSet];

      // (4) Round complete? Covers-all-voters check uses canonical-sorted
      // voterSet (cli line 2563) so late joiners don't permanently block the
      // round. If voterSet is empty, the round trivially completes.
      const voterSetCanonical = voterSet.length === 0 ? [] : [...voterSet].sort();
      const coversAll = voterSetCanonical.length === 0
        || voterSetCanonical.every((v) => broadcastSet.has(v));
      if (coversAll) {
        proposal.gossipRound = gossipRound + 1;
        proposal.currentRoundBroadcastSet = [];
        proposal.roundStartedAt = new Date().toISOString();
      }

      // (5) Per-round timeout — force-advance if a round has been open too
      // long. Return value discarded in vote path per ADR-0184 Wave 4 DA
      // observation (vote path mutates for side effects only; status path
      // captures the `advanced` flag for persistence-decision).
      maybeAdvanceGossipRoundOnTimeout(proposal);

      // (6) Settle predicate.
      const gossipSettleResult = settleCheckGossip(proposal);
      if (gossipSettleResult.settled && gossipSettleResult.result) {
        const resolution = gossipSettleResult.result;
        proposal.status = resolution;
        const historyRow: ConsensusHistoryRow = {
          proposalId: proposal.proposalId,
          type: proposal.type,
          result: resolution,
          votes: { for: votesFor, against: votesAgainst },
          decidedAt: new Date().toISOString(),
          strategy: 'gossip',
          // term + byzantineDetected: undefined for gossip per Wave 4 DA Axis (e).
        };
        consensus.history.push(historyRow);
        consensus.pending = consensus.pending.filter(
          (p) => p.proposalId !== proposal.proposalId,
        );
      } else if (gossipSettleResult.exhausted) {
        // Hard budget exhausted: per `feedback-no-fallbacks.md`, do NOT
        // silently coerce to a settled tally. Status stays 'pending';
        // gossipExhausted flag set per ADR-0184 Wave 4 DA Concern 2 so
        // Wave 6 cli surfaces `exhausted: true` via post-dispatch re-read.
        proposal.gossipExhausted = true;
      }

      // Single `saveHiveStateToHandle` per the vote action — covers
      // broadcastSet mutations, round-advance, timeout-advance, and (if
      // settled) the history-push + pending-filter. One write = one audit
      // entry per ADR-0180 §Confirmation. Cli persists unconditionally on
      // vote (line 2613); archivist mirrors this — the bookkeeping
      // mutations always need persisting, even when no resolution fired.
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
      if (proposal.strategy !== 'gossip') {
        throw new Error(
          `hive-mind_consensus.status: proposal ${proposalId} is ${proposal.strategy}, ` +
            `not gossip — caller supplied wrong strategy`,
        );
      }

      // Cli line 2769: capture the `advanced` flag — if a timeout fired,
      // we MUST persist even if `settleCheckGossip` doesn't settle.
      const advanced = maybeAdvanceGossipRoundOnTimeout(proposal);
      const gossipSettleResult = settleCheckGossip(proposal);

      let mutated = reconciled || advanced;

      if (gossipSettleResult.settled && gossipSettleResult.result) {
        const resolution = gossipSettleResult.result;
        const votesFor = Object.values(proposal.votes).filter((v) => v).length;
        const votesAgainst = Object.values(proposal.votes).filter((v) => !v).length;

        proposal.status = resolution;
        const historyRow: ConsensusHistoryRow = {
          proposalId: proposal.proposalId,
          type: proposal.type,
          result: resolution,
          votes: { for: votesFor, against: votesAgainst },
          decidedAt: new Date().toISOString(),
          strategy: 'gossip',
        };
        consensus.history.push(historyRow);
        consensus.pending = consensus.pending.filter(
          (p) => p.proposalId !== proposal.proposalId,
        );
        mutated = true;
      } else if (gossipSettleResult.exhausted) {
        // Hard-budget exhaustion during status — same handling as vote path.
        if (!proposal.gossipExhausted) {
          proposal.gossipExhausted = true;
          mutated = true;
        }
      }

      if (mutated) await saveHiveStateToHandle(handle, state);
      return;
    }

    case 'list': {
      // Read-only enumeration; parent dispatcher's withWrite is the audit
      // boundary. No write needed.
      return;
    }

    default: {
      const _exhaustive: never = payload;
      throw new Error(
        `hive-mind_consensus.gossip: unknown action ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}
