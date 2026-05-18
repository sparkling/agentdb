// charter: mutation-invariants
// ADR-0184 Wave 2 — bft strategy invariants. Payload-shape checks only per
// ADR-0184 Wave 2 DA Axis (f): post-mutation state-snapshot checks (history
// row threshold arithmetic, byzantineVoters ∩ valid voters = ∅) belong in
// unit tests, NOT here — the invariant signature receives only `callerIntent`
// + `recordedPayload`, no before/after state.
//
// The parent dispatcher (handlers/hive-mind/consensus.ts) normalises
// `byzantine → bft` before dispatch (Wave 1 mechanism), so every invariant
// here matches on `payload.strategy === 'bft'` alone — `'byzantine'`
// carry-forward is already collapsed at handler entry.

import type { Invariant } from '../../../registration.js';
import type { HiveMindConsensusPayload } from '../../../handlers/hive-mind/consensus.js';

export type { HiveMindConsensusPayload };

const VOTER_ID_MAX = 500;
const PROPOSAL_ID_MAX = 500;
const TYPE_MAX = 500;

/** vote action: voterId must be a non-empty bounded string. */
const bftVoteVoterIdWellFormed: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote') return 'pass';
  if (recordedPayload.strategy !== 'bft') return 'pass';
  const v = recordedPayload.voterId;
  if (typeof v !== 'string' || v.length === 0) {
    return { violated: true, detail: `bft.vote: voterId must be a non-empty string, got ${typeof v}` };
  }
  if (v.length > VOTER_ID_MAX) {
    return { violated: true, detail: `bft.vote: voterId length ${v.length} exceeds ${VOTER_ID_MAX}` };
  }
  return 'pass';
};

/** vote action: vote must be boolean. */
const bftVoteValueIsBoolean: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote') return 'pass';
  if (recordedPayload.strategy !== 'bft') return 'pass';
  const v = recordedPayload.vote;
  if (typeof v !== 'boolean') {
    return { violated: true, detail: `bft.vote: vote must be boolean, got ${typeof v}` };
  }
  return 'pass';
};

/** vote / status: proposalId must be a non-empty bounded string. */
const bftProposalIdWellFormed: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote' && recordedPayload.action !== 'status') {
    return 'pass';
  }
  if ('strategy' in recordedPayload && recordedPayload.strategy !== 'bft') return 'pass';
  const p = recordedPayload.proposalId;
  if (typeof p !== 'string' || p.length === 0) {
    return { violated: true, detail: `bft.${recordedPayload.action}: proposalId must be a non-empty string, got ${typeof p}` };
  }
  if (p.length > PROPOSAL_ID_MAX) {
    return { violated: true, detail: `bft.${recordedPayload.action}: proposalId length ${p.length} exceeds ${PROPOSAL_ID_MAX}` };
  }
  return 'pass';
};

/** propose: type must be a non-empty bounded string when present. */
const bftProposeTypeWellFormedWhenPresent: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'propose') return 'pass';
  if (recordedPayload.strategy !== 'bft') return 'pass';
  const t = recordedPayload.type;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `bft.propose: type must be a non-empty string when present, got ${typeof t}` };
  }
  if (t.length > TYPE_MAX) {
    return { violated: true, detail: `bft.propose: type length ${t.length} exceeds ${TYPE_MAX}` };
  }
  return 'pass';
};

/** propose: timeoutMs must be a positive finite number when present. */
const bftProposeTimeoutMsWellFormedWhenPresent: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'propose') return 'pass';
  if (recordedPayload.strategy !== 'bft') return 'pass';
  const t = recordedPayload.timeoutMs;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) {
    return { violated: true, detail: `bft.propose: timeoutMs must be a positive finite number, got ${String(t)}` };
  }
  return 'pass';
};

export const bftConsensusInvariants: ReadonlyArray<Invariant<HiveMindConsensusPayload>> = [
  bftVoteVoterIdWellFormed,
  bftVoteValueIsBoolean,
  bftProposalIdWellFormed,
  bftProposeTypeWellFormedWhenPresent,
  bftProposeTimeoutMsWellFormedWhenPresent,
];
