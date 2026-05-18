// charter: mutation-invariants
// ADR-0184 Wave 5 — crdt strategy invariants. Payload-shape checks only per
// ADR-0184 Wave 2 DA Axis (f): the CvRDT correctness triad (merge
// idempotency, commutativity, associativity) lives in
// `test/archivist/handlers/hive-mind/consensus/crdt.test.ts` as sampled-
// property tests over `mergeCRDTState` — NOT here. The invariant signature
// receives only `recordedPayload`, no before/after state snapshot.
//
// CRDT-specific deviation: `vote` is OPTIONAL per ADR-0121 row 14, so the
// invariant uses `!== undefined &&` guard rather than a bare typeof check.

import type { Invariant } from '../../../registration.js';
import type { HiveMindConsensusPayload } from '../../../handlers/hive-mind/consensus.js';

export type { HiveMindConsensusPayload };

const VOTER_ID_MAX = 500;
const PROPOSAL_ID_MAX = 500;
const TYPE_MAX = 500;

/** vote action: voterId must be a non-empty bounded string. */
const crdtVoteVoterIdWellFormed: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote') return 'pass';
  if (recordedPayload.strategy !== 'crdt') return 'pass';
  const v = recordedPayload.voterId;
  if (typeof v !== 'string' || v.length === 0) {
    return { violated: true, detail: `crdt.vote: voterId must be a non-empty string, got ${typeof v}` };
  }
  if (v.length > VOTER_ID_MAX) {
    return { violated: true, detail: `crdt.vote: voterId length ${v.length} exceeds ${VOTER_ID_MAX}` };
  }
  return 'pass';
};

/** vote action: vote must be boolean OR undefined (CRDT permits implicit
 *  vote per ADR-0121 row 14 — boolean inferred from approvers ∋ voterId,
 *  else explicit vote, else default false). Per Wave 5 DA Concern 6: the
 *  bare typeof check would fire on legitimately-omitted vote. */
const crdtVoteValueIsBooleanOrUndefined: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote') return 'pass';
  if (recordedPayload.strategy !== 'crdt') return 'pass';
  const v = recordedPayload.vote;
  if (v !== undefined && typeof v !== 'boolean') {
    return { violated: true, detail: `crdt.vote: vote must be boolean or undefined, got ${typeof v}` };
  }
  return 'pass';
};

/** vote action: crdtSnapshot (when present) must be an object. Full triple-
 *  key validation (`votes`/`approvers`/`verdict`) lives in the handler body
 *  per Wave 5 DA Concern 3 — clearer error messages than invariant format. */
const crdtVoteSnapshotShapeWhenPresent: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote') return 'pass';
  if (recordedPayload.strategy !== 'crdt') return 'pass';
  const s = recordedPayload.crdtSnapshot;
  if (s === undefined || s === null) return 'pass';
  if (typeof s !== 'object') {
    return { violated: true, detail: `crdt.vote: crdtSnapshot must be an object when present, got ${typeof s}` };
  }
  return 'pass';
};

/** vote / status: proposalId must be a non-empty bounded string. */
const crdtProposalIdWellFormed: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote' && recordedPayload.action !== 'status') {
    return 'pass';
  }
  if ('strategy' in recordedPayload && recordedPayload.strategy !== 'crdt') return 'pass';
  const p = recordedPayload.proposalId;
  if (typeof p !== 'string' || p.length === 0) {
    return { violated: true, detail: `crdt.${recordedPayload.action}: proposalId must be a non-empty string, got ${typeof p}` };
  }
  if (p.length > PROPOSAL_ID_MAX) {
    return { violated: true, detail: `crdt.${recordedPayload.action}: proposalId length ${p.length} exceeds ${PROPOSAL_ID_MAX}` };
  }
  return 'pass';
};

/** propose: type must be a non-empty bounded string when present. */
const crdtProposeTypeWellFormedWhenPresent: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'propose') return 'pass';
  if (recordedPayload.strategy !== 'crdt') return 'pass';
  const t = recordedPayload.type;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `crdt.propose: type must be a non-empty string when present, got ${typeof t}` };
  }
  if (t.length > TYPE_MAX) {
    return { violated: true, detail: `crdt.propose: type length ${t.length} exceeds ${TYPE_MAX}` };
  }
  return 'pass';
};

/** propose: roundTimeoutMs must be a positive finite number when present. */
const crdtProposeRoundTimeoutMsWellFormedWhenPresent: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'propose') return 'pass';
  if (recordedPayload.strategy !== 'crdt') return 'pass';
  const t = recordedPayload.roundTimeoutMs;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) {
    return { violated: true, detail: `crdt.propose: roundTimeoutMs must be a positive finite number, got ${String(t)}` };
  }
  return 'pass';
};

export const crdtConsensusInvariants: ReadonlyArray<Invariant<HiveMindConsensusPayload>> = [
  crdtVoteVoterIdWellFormed,
  crdtVoteValueIsBooleanOrUndefined,
  crdtVoteSnapshotShapeWhenPresent,
  crdtProposalIdWellFormed,
  crdtProposeTypeWellFormedWhenPresent,
  crdtProposeRoundTimeoutMsWellFormedWhenPresent,
];
