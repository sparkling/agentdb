// charter: mutation-invariants
// ADR-0184 Wave 2 commit 2 — raft strategy invariants. Payload-shape checks
// only per ADR-0184 Wave 2 DA Axis (f): post-mutation state-snapshot checks
// (single-pending-per-term, term monotonicity) belong in unit tests.
//
// Raft is the parent dispatcher's default strategy (cli parity); these
// invariants permit `strategy === undefined` for the status/list discriminants
// that have no `strategy` field on the wire.

import type { Invariant } from '../../../registration.js';
import type { HiveMindConsensusPayload } from '../../../handlers/hive-mind/consensus.js';

export type { HiveMindConsensusPayload };

const VOTER_ID_MAX = 500;
const PROPOSAL_ID_MAX = 500;
const TYPE_MAX = 500;

function isRaft(payload: HiveMindConsensusPayload): boolean {
  if (payload.action === 'status' || payload.action === 'list') {
    return true;
  }
  if ('strategy' in payload) {
    return payload.strategy === undefined || payload.strategy === 'raft';
  }
  return true;
}

/** vote action: voterId must be a non-empty bounded string. */
const raftVoteVoterIdWellFormed: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote') return 'pass';
  if (!isRaft(recordedPayload)) return 'pass';
  const v = recordedPayload.voterId;
  if (typeof v !== 'string' || v.length === 0) {
    return { violated: true, detail: `raft.vote: voterId must be a non-empty string, got ${typeof v}` };
  }
  if (v.length > VOTER_ID_MAX) {
    return { violated: true, detail: `raft.vote: voterId length ${v.length} exceeds ${VOTER_ID_MAX}` };
  }
  return 'pass';
};

/** vote action: vote must be boolean. */
const raftVoteValueIsBoolean: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote') return 'pass';
  if (!isRaft(recordedPayload)) return 'pass';
  const v = recordedPayload.vote;
  if (typeof v !== 'boolean') {
    return { violated: true, detail: `raft.vote: vote must be boolean, got ${typeof v}` };
  }
  return 'pass';
};

/** propose: term must be a positive integer when present. */
const raftProposeTermWellFormedWhenPresent: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'propose') return 'pass';
  if (!isRaft(recordedPayload)) return 'pass';
  const t = recordedPayload.term;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'number' || !Number.isFinite(t) || !Number.isInteger(t) || t < 1) {
    return { violated: true, detail: `raft.propose: term must be a positive integer when present, got ${String(t)}` };
  }
  return 'pass';
};

/** propose: timeoutMs must be a positive finite number when present. */
const raftProposeTimeoutMsWellFormedWhenPresent: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'propose') return 'pass';
  if (!isRaft(recordedPayload)) return 'pass';
  const t = recordedPayload.timeoutMs;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) {
    return { violated: true, detail: `raft.propose: timeoutMs must be a positive finite number, got ${String(t)}` };
  }
  return 'pass';
};

/** vote / status: proposalId must be a non-empty bounded string. */
const raftProposalIdWellFormed: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote' && recordedPayload.action !== 'status') {
    return 'pass';
  }
  if (!isRaft(recordedPayload)) return 'pass';
  const p = recordedPayload.proposalId;
  if (typeof p !== 'string' || p.length === 0) {
    return { violated: true, detail: `raft.${recordedPayload.action}: proposalId must be a non-empty string, got ${typeof p}` };
  }
  if (p.length > PROPOSAL_ID_MAX) {
    return { violated: true, detail: `raft.${recordedPayload.action}: proposalId length ${p.length} exceeds ${PROPOSAL_ID_MAX}` };
  }
  return 'pass';
};

/** propose: type must be a non-empty bounded string when present. */
const raftProposeTypeWellFormedWhenPresent: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'propose') return 'pass';
  if (!isRaft(recordedPayload)) return 'pass';
  const t = recordedPayload.type;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `raft.propose: type must be a non-empty string when present, got ${typeof t}` };
  }
  if (t.length > TYPE_MAX) {
    return { violated: true, detail: `raft.propose: type length ${t.length} exceeds ${TYPE_MAX}` };
  }
  return 'pass';
};

export const raftConsensusInvariants: ReadonlyArray<Invariant<HiveMindConsensusPayload>> = [
  raftVoteVoterIdWellFormed,
  raftVoteValueIsBoolean,
  raftProposeTermWellFormedWhenPresent,
  raftProposeTimeoutMsWellFormedWhenPresent,
  raftProposalIdWellFormed,
  raftProposeTypeWellFormedWhenPresent,
];
