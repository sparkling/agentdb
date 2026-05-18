// charter: mutation-invariants
// ADR-0184 Wave 3 — weighted strategy invariants. Payload-shape checks only
// per ADR-0184 Wave 2 DA Axis (f): post-mutation state-snapshot checks
// (weight-sum validation against history-row arithmetic) belong in unit tests,
// NOT here — the invariant signature receives only payload, no state.

import type { Invariant } from '../../../registration.js';
import type { HiveMindConsensusPayload } from '../../../handlers/hive-mind/consensus.js';

export type { HiveMindConsensusPayload };

const VOTER_ID_MAX = 500;
const PROPOSAL_ID_MAX = 500;
const TYPE_MAX = 500;

/** vote action: voterId must be a non-empty bounded string. */
const weightedVoteVoterIdWellFormed: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote') return 'pass';
  if (recordedPayload.strategy !== 'weighted') return 'pass';
  const v = recordedPayload.voterId;
  if (typeof v !== 'string' || v.length === 0) {
    return { violated: true, detail: `weighted.vote: voterId must be a non-empty string, got ${typeof v}` };
  }
  if (v.length > VOTER_ID_MAX) {
    return { violated: true, detail: `weighted.vote: voterId length ${v.length} exceeds ${VOTER_ID_MAX}` };
  }
  return 'pass';
};

/** vote action: vote must be boolean. */
const weightedVoteValueIsBoolean: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote') return 'pass';
  if (recordedPayload.strategy !== 'weighted') return 'pass';
  const v = recordedPayload.vote;
  if (typeof v !== 'boolean') {
    return { violated: true, detail: `weighted.vote: vote must be boolean, got ${typeof v}` };
  }
  return 'pass';
};

/** vote / status: proposalId must be a non-empty bounded string. */
const weightedProposalIdWellFormed: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote' && recordedPayload.action !== 'status') {
    return 'pass';
  }
  if ('strategy' in recordedPayload && recordedPayload.strategy !== 'weighted') return 'pass';
  const p = recordedPayload.proposalId;
  if (typeof p !== 'string' || p.length === 0) {
    return { violated: true, detail: `weighted.${recordedPayload.action}: proposalId must be a non-empty string, got ${typeof p}` };
  }
  if (p.length > PROPOSAL_ID_MAX) {
    return { violated: true, detail: `weighted.${recordedPayload.action}: proposalId length ${p.length} exceeds ${PROPOSAL_ID_MAX}` };
  }
  return 'pass';
};

/** propose: type must be a non-empty bounded string when present. */
const weightedProposeTypeWellFormedWhenPresent: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'propose') return 'pass';
  if (recordedPayload.strategy !== 'weighted') return 'pass';
  const t = recordedPayload.type;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `weighted.propose: type must be a non-empty string when present, got ${typeof t}` };
  }
  if (t.length > TYPE_MAX) {
    return { violated: true, detail: `weighted.propose: type length ${t.length} exceeds ${TYPE_MAX}` };
  }
  return 'pass';
};

/** propose: timeoutMs must be a positive finite number when present. */
const weightedProposeTimeoutMsWellFormedWhenPresent: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'propose') return 'pass';
  if (recordedPayload.strategy !== 'weighted') return 'pass';
  const t = recordedPayload.timeoutMs;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) {
    return { violated: true, detail: `weighted.propose: timeoutMs must be a positive finite number, got ${String(t)}` };
  }
  return 'pass';
};

export const weightedConsensusInvariants: ReadonlyArray<Invariant<HiveMindConsensusPayload>> = [
  weightedVoteVoterIdWellFormed,
  weightedVoteValueIsBoolean,
  weightedProposalIdWellFormed,
  weightedProposeTypeWellFormedWhenPresent,
  weightedProposeTimeoutMsWellFormedWhenPresent,
];
