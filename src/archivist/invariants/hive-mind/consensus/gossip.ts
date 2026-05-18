// charter: mutation-invariants
// ADR-0184 Wave 4 — gossip strategy invariants. Payload-shape checks only per
// ADR-0184 Wave 2 DA Axis (f): post-mutation state-snapshot checks
// (round-bound monotonicity, settle-condition correctness against canonical
// voter set) belong in unit tests, NOT here.
//
// Gossip uses `roundTimeoutMs` (not the threshold-strategy `timeoutMs`); the
// invariant validates the gossip-specific knob.

import type { Invariant } from '../../../registration.js';
import type { HiveMindConsensusPayload } from '../../../handlers/hive-mind/consensus.js';

export type { HiveMindConsensusPayload };

const VOTER_ID_MAX = 500;
const PROPOSAL_ID_MAX = 500;
const TYPE_MAX = 500;

/** vote action: voterId must be a non-empty bounded string. */
const gossipVoteVoterIdWellFormed: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote') return 'pass';
  if (recordedPayload.strategy !== 'gossip') return 'pass';
  const v = recordedPayload.voterId;
  if (typeof v !== 'string' || v.length === 0) {
    return { violated: true, detail: `gossip.vote: voterId must be a non-empty string, got ${typeof v}` };
  }
  if (v.length > VOTER_ID_MAX) {
    return { violated: true, detail: `gossip.vote: voterId length ${v.length} exceeds ${VOTER_ID_MAX}` };
  }
  return 'pass';
};

/** vote action: vote must be boolean. */
const gossipVoteValueIsBoolean: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote') return 'pass';
  if (recordedPayload.strategy !== 'gossip') return 'pass';
  const v = recordedPayload.vote;
  if (typeof v !== 'boolean') {
    return { violated: true, detail: `gossip.vote: vote must be boolean, got ${typeof v}` };
  }
  return 'pass';
};

/** vote / status: proposalId must be a non-empty bounded string. */
const gossipProposalIdWellFormed: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote' && recordedPayload.action !== 'status') {
    return 'pass';
  }
  if ('strategy' in recordedPayload && recordedPayload.strategy !== 'gossip') return 'pass';
  const p = recordedPayload.proposalId;
  if (typeof p !== 'string' || p.length === 0) {
    return { violated: true, detail: `gossip.${recordedPayload.action}: proposalId must be a non-empty string, got ${typeof p}` };
  }
  if (p.length > PROPOSAL_ID_MAX) {
    return { violated: true, detail: `gossip.${recordedPayload.action}: proposalId length ${p.length} exceeds ${PROPOSAL_ID_MAX}` };
  }
  return 'pass';
};

/** propose: type must be a non-empty bounded string when present. */
const gossipProposeTypeWellFormedWhenPresent: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'propose') return 'pass';
  if (recordedPayload.strategy !== 'gossip') return 'pass';
  const t = recordedPayload.type;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `gossip.propose: type must be a non-empty string when present, got ${typeof t}` };
  }
  if (t.length > TYPE_MAX) {
    return { violated: true, detail: `gossip.propose: type length ${t.length} exceeds ${TYPE_MAX}` };
  }
  return 'pass';
};

/** propose: roundTimeoutMs must be a positive finite number when present. */
const gossipProposeRoundTimeoutMsWellFormedWhenPresent: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'propose') return 'pass';
  if (recordedPayload.strategy !== 'gossip') return 'pass';
  const t = recordedPayload.roundTimeoutMs;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) {
    return { violated: true, detail: `gossip.propose: roundTimeoutMs must be a positive finite number, got ${String(t)}` };
  }
  return 'pass';
};

export const gossipConsensusInvariants: ReadonlyArray<Invariant<HiveMindConsensusPayload>> = [
  gossipVoteVoterIdWellFormed,
  gossipVoteValueIsBoolean,
  gossipProposalIdWellFormed,
  gossipProposeTypeWellFormedWhenPresent,
  gossipProposeRoundTimeoutMsWellFormedWhenPresent,
];
