// charter: dispatch
// ADR-0184 Wave 5 — crdt strategy handler body. Ports cli `hive-mind-tools.ts`
// `hive-mind_consensus` CRDT branches verbatim (ADR-0121 T3):
//   propose: crdtState = emptyCRDTState(); crdtExpectedVoters snapshotted at
//            propose-time; roundTimeoutMs from input or
//            GOSSIP_ROUND_TIMEOUT_MS_DEFAULT; roundStartedAt set;
//            threshold-strategy timeoutAt explicit undefined (CRDT uses
//            roundStartedAt + roundTimeoutMs settling, NOT threshold timeoutAt)
//   vote:    optional crdtSnapshot triple validation (throws on partial shape
//            per `feedback-no-fallbacks`); synthesize minimal snapshot when
//            caller omits (GCounter.increment + ORSet.add IFF approving +
//            LWWRegister.write of proposal.value IFF approving); mergeCRDTState
//            into proposal.crdtState accumulator; track voter participation
//            via proposal.votes; CRDT permits same-voter re-submission (LWW
//            handles collisions) — short-circuits the bft/raft/quorum/weighted
//            double-vote rejection; force-settle when distinctVoters >=
//            crdtExpectedVoters OR timeout fired; resolution = 'approved' iff
//            approverCount > 0 AND approverCount * 2 >= totalCast
//   status:  read merged triple via .from(...) constructors + timeout check +
//            same force-settle arithmetic as vote (cli line 2803 guard:
//            `proposal.crdtState` defensive check preserved per Wave 5 DA
//            Axis (e) — skip force-settle if crdtState absent)
//   list:    no-op (parent dispatcher's withWrite scope is the audit boundary)
//
// CRDT-specific deviations from bft/raft/quorum/weighted/gossip:
//   - `vote?: boolean` is OPTIONAL per ADR-0121 row 14 (boolean implicit from
//     approvers contains voterId, else explicit vote, else default false).
//     The typeof check that other strategies enforce is short-circuited for CRDT.
//   - Same-voter re-submission is ACCEPTED per ADR-0121 row 12 DEFER-TO-IMPL.
//     The bft/raft/quorum/weighted double-vote-rejection branch is bypassed —
//     LWW-Register handles same-millisecond collisions deterministically.

import type { MutationContext, SubstrateHandle } from '../../../index.js';
import type { HiveMindConsensusPayload } from '../consensus.js';
import {
  type ConsensusProposal,
  type ConsensusHistoryRow,
  type CRDTState,
  GOSSIP_ROUND_TIMEOUT_MS_DEFAULT,
  ensureConsensusContainer,
  loadHiveStateFromHandle,
  ProposalAlreadyFailedError,
  ProposalNotFoundError,
  reconcileFailedFromStatusKeys,
  saveHiveStateToHandle,
  VoterIdRequiredError,
  WorkerAlreadyFailedError,
  workerMetaFor,
} from './_shared.js';
import {
  emptyCRDTState,
  GCounter,
  LWWRegister,
  mergeCRDTState,
  ORSet,
} from './_crdt-types.js';

export async function handleCrdtConsensus(
  _ctx: MutationContext<false>,
  handle: SubstrateHandle,
  payload: HiveMindConsensusPayload,
): Promise<void> {
  const state = await loadHiveStateFromHandle(handle);
  if (!state) {
    throw new Error(
      'hive-mind_consensus.crdt: hive-mind state not initialized — run hive-mind_init first',
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
      const crdtExpectedVoters = Math.max(1, totalNodes);

      // Per ADR-0184 Wave 2 DA Axis (h): explicit `undefined` for non-CRDT
      // fields so a prior proposal's stale field shape cannot leak through
      // `state.consensus.pending`. Threshold-strategy `timeoutAt` is
      // undefined for CRDT (cli `isThresholdBased` excludes CRDT per line
      // 2116-2128) — CRDT uses roundStartedAt + roundTimeoutMs settling.
      const proposal: ConsensusProposal = {
        proposalId,
        type: payload.type ?? 'general',
        value: payload.value,
        proposedBy: payload.voterId ?? 'system',
        proposedAt: new Date().toISOString(),
        votes: {},
        status: 'pending',
        strategy: 'crdt',
        timeoutAt: undefined,
        roundTimeoutMs,
        roundStartedAt: new Date().toISOString(),
        crdtState: emptyCRDTState(),
        crdtExpectedVoters,
        // Non-CRDT fields explicitly undefined.
        term: undefined,
        quorumPreset: undefined,
        byzantineVoters: undefined,
        gossipRound: undefined,
        lastVoteChangedRound: undefined,
        totalNodes: undefined,
        currentRoundBroadcastSet: undefined,
        gossipExhausted: undefined,
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
      if (proposal.strategy !== 'crdt') {
        throw new Error(
          `hive-mind_consensus.vote: proposal ${proposalId} is ${proposal.strategy}, ` +
            `not crdt — caller supplied wrong strategy`,
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

      // CRDT vote-value typing deviation: `vote` is OPTIONAL for CRDT per
      // ADR-0121 row 14 (boolean implicit from approvers, else explicit vote,
      // else default false). The `typeof !== 'boolean'` check that other
      // strategies enforce is short-circuited here. The CRDT vote-value is
      // treated as `voteValue === true` for "is approving" semantics; a
      // missing vote AND missing crdtSnapshot synthesises an empty snapshot.
      const voteValue = payload.vote;

      // Validate optional crdtSnapshot shape per `feedback-no-fallbacks.md`.
      // Per Wave 5 DA Concern 3: full triple-key check happens here (cli
      // verbatim, line 2257-2270), not in the invariant — clearer error
      // messages and easier to mirror cli's exact throw text.
      const rawSnapshot =
        'crdtSnapshot' in payload ? payload.crdtSnapshot : undefined;
      let snapshot: CRDTState | undefined;
      if (rawSnapshot !== undefined) {
        if (typeof rawSnapshot !== 'object' || rawSnapshot === null) {
          throw new Error(
            `hive-mind_consensus.vote: crdtSnapshot must be an object, got ${typeof rawSnapshot}`,
          );
        }
        const obj = rawSnapshot as Record<string, unknown>;
        if (!('votes' in obj) || !('approvers' in obj) || !('verdict' in obj)) {
          throw new Error(
            'hive-mind_consensus.vote: crdtSnapshot must contain { votes, approvers, verdict }',
          );
        }
        snapshot = obj as unknown as CRDTState;
      }

      // Build the voter's CRDT snapshot. Two paths (cli line 2272-2302):
      //   (a) caller-supplied — use verbatim.
      //   (b) synthesize from boolean — GCounter.increment + ORSet.add IFF
      //       approving + LWWRegister.write of proposal.value IFF approving.
      const wallClockMs = Date.now();
      let voterSnapshot: CRDTState;
      if (snapshot !== undefined) {
        voterSnapshot = snapshot;
      } else {
        const g = new GCounter();
        g.increment(voterId);
        const aps = new ORSet<string>();
        const isApproving = voteValue === true;
        if (isApproving) aps.add(voterId, voterId);
        const reg = new LWWRegister<unknown>();
        if (isApproving) {
          reg.write(proposal.value, voterId, wallClockMs);
        }
        voterSnapshot = {
          votes: g.toJSON(),
          approvers: aps.toJSON(),
          verdict: reg.toJSON(),
        };
      }

      // Merge into the proposal's accumulator (initialised empty at propose-time).
      // Per ADR-0184 Wave 5 DA Concern 2: CRDT permits same-voter re-submission
      // — LWW-Register handles same-millisecond collisions deterministically.
      // The bft/raft/quorum/weighted double-vote-rejection branch is bypassed.
      const before = proposal.crdtState ?? emptyCRDTState();
      proposal.crdtState = mergeCRDTState(before, voterSnapshot);

      // Track voter participation via the existing `votes` map. Boolean is
      // implicit per ADR-0121 row 14: true if approvers contains voter, else
      // explicit `vote` value, else default false. Cli line 2308-2313.
      const approverIds = ORSet.from<string>(proposal.crdtState.approvers).elements();
      const voterIsApprover = approverIds.includes(voterId);
      proposal.votes[voterId] = voterIsApprover ? true : (voteValue ?? false);

      // Settlement: all expected voters submitted, OR timeout fired.
      // Per ADR-0121 row 10 DEFER-TO-IMPL (union of voter-count + timeoutMs).
      const distinctVoters = Object.keys(proposal.votes).length;
      const expected = proposal.crdtExpectedVoters ?? Math.max(1, totalNodes);
      const allSubmitted = distinctVoters >= expected;

      let timedOut = false;
      if (proposal.roundStartedAt && proposal.roundTimeoutMs) {
        const elapsed = wallClockMs - new Date(proposal.roundStartedAt).getTime();
        if (elapsed >= proposal.roundTimeoutMs) timedOut = true;
      }

      if (allSubmitted || timedOut) {
        // Resolution from the merged triple (cli line 2336-2347):
        // 'approved' iff approverCount > 0 AND approverCount * 2 >= totalCast
        // (strict majority of cast votes were approvers). Otherwise rejected.
        const approverCount = approverIds.length;
        const totalCast = distinctVoters;
        const crdtResolution: 'approved' | 'rejected' =
          approverCount > 0 && approverCount * 2 >= totalCast
            ? 'approved'
            : 'rejected';
        proposal.status = crdtResolution;
        const historyRow: ConsensusHistoryRow = {
          proposalId: proposal.proposalId,
          type: proposal.type,
          result: crdtResolution,
          votes: { for: approverCount, against: Math.max(0, totalCast - approverCount) },
          decidedAt: new Date(wallClockMs).toISOString(),
          strategy: 'crdt',
          // term + byzantineDetected: undefined for crdt.
        };
        consensus.history.push(historyRow);
        consensus.pending = consensus.pending.filter(
          (p) => p.proposalId !== proposal.proposalId,
        );
      }

      // Single saveHiveStateToHandle per ADR-0180 §Confirmation — covers
      // crdtState merge mutation, voter tracking, and (if settled) the
      // history-push + pending-filter.
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
      if (proposal.strategy !== 'crdt') {
        throw new Error(
          `hive-mind_consensus.status: proposal ${proposalId} is ${proposal.strategy}, ` +
            `not crdt — caller supplied wrong strategy`,
        );
      }

      let mutated = reconciled;

      // Per Wave 5 DA Axis (e): cli at line 2803 guards the CRDT settle block
      // with `if (proposalStrategy === 'crdt' && proposal.crdtState)`. The
      // crdtState guard is defensive — propose initialises crdtState to
      // emptyCRDTState() so missing-state shouldn't happen, but mirror cli
      // verbatim. Skip the force-settle block if crdtState is absent.
      if (proposal.crdtState) {
        const approverSet = ORSet.from<string>(proposal.crdtState.approvers);
        const crdtApproverList = approverSet.elements();

        // Timeout check (cli line 2811-2815).
        let crdtTimedOut = false;
        if (proposal.roundStartedAt && proposal.roundTimeoutMs) {
          const elapsed = Date.now() - new Date(proposal.roundStartedAt).getTime();
          if (elapsed >= proposal.roundTimeoutMs) crdtTimedOut = true;
        }

        // Force-settle if all expected voters submitted OR timeout fired
        // (cli line 2820-2840).
        const distinctVoters = Object.keys(proposal.votes).length;
        const expected = proposal.crdtExpectedVoters ?? 1;
        if (distinctVoters >= expected || crdtTimedOut) {
          const approverCount = crdtApproverList.length;
          const totalCast = distinctVoters;
          const crdtResult: 'approved' | 'rejected' =
            approverCount > 0 && approverCount * 2 >= totalCast
              ? 'approved'
              : 'rejected';
          proposal.status = crdtResult;
          const historyRow: ConsensusHistoryRow = {
            proposalId: proposal.proposalId,
            type: proposal.type,
            result: crdtResult,
            votes: { for: approverCount, against: Math.max(0, totalCast - approverCount) },
            decidedAt: new Date().toISOString(),
            strategy: 'crdt',
          };
          consensus.history.push(historyRow);
          consensus.pending = consensus.pending.filter(
            (p) => p.proposalId !== proposal.proposalId,
          );
          mutated = true;
        }
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
        `hive-mind_consensus.crdt: unknown action ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}
