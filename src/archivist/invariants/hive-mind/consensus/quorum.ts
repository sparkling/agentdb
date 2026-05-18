// charter: mutation-invariants
// ADR-0184 Wave 2 commit 3 — quorum strategy invariants. Payload-shape
// checks only per ADR-0184 Wave 2 DA Axis (f): post-mutation arithmetic
// checks (history-row votesFor for unanimous=N etc.) belong in unit tests.

import type { Invariant } from '../../../registration.js';
import type { HiveMindConsensusPayload } from '../../../handlers/hive-mind/consensus.js';

export type { HiveMindConsensusPayload };

const VALID_PRESETS = new Set(['unanimous', 'majority', 'supermajority']);
const VOTER_ID_MAX = 500;
const PROPOSAL_ID_MAX = 500;
const TYPE_MAX = 500;

/** propose: quorumPreset must be in the enum when present. */
const quorumProposeQuorumPresetEnum: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'propose') return 'pass';
  if (recordedPayload.strategy !== 'quorum') return 'pass';
  const q = recordedPayload.quorumPreset;
  if (q === undefined || q === null) return 'pass';
  if (typeof q !== 'string' || !VALID_PRESETS.has(q)) {
    return { violated: true, detail: `quorum.propose: quorumPreset must be one of {unanimous,majority,supermajority}, got ${JSON.stringify(q)}` };
  }
  return 'pass';
};

/** vote action: voterId must be a non-empty bounded string. */
const quorumVoteVoterIdWellFormed: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote') return 'pass';
  if (recordedPayload.strategy !== 'quorum') return 'pass';
  const v = recordedPayload.voterId;
  if (typeof v !== 'string' || v.length === 0) {
    return { violated: true, detail: `quorum.vote: voterId must be a non-empty string, got ${typeof v}` };
  }
  if (v.length > VOTER_ID_MAX) {
    return { violated: true, detail: `quorum.vote: voterId length ${v.length} exceeds ${VOTER_ID_MAX}` };
  }
  return 'pass';
};

/** vote action: vote must be boolean. */
const quorumVoteValueIsBoolean: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote') return 'pass';
  if (recordedPayload.strategy !== 'quorum') return 'pass';
  const v = recordedPayload.vote;
  if (typeof v !== 'boolean') {
    return { violated: true, detail: `quorum.vote: vote must be boolean, got ${typeof v}` };
  }
  return 'pass';
};

/** vote / status: proposalId must be a non-empty bounded string. */
const quorumProposalIdWellFormed: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'vote' && recordedPayload.action !== 'status') {
    return 'pass';
  }
  if ('strategy' in recordedPayload && recordedPayload.strategy !== 'quorum') return 'pass';
  const p = recordedPayload.proposalId;
  if (typeof p !== 'string' || p.length === 0) {
    return { violated: true, detail: `quorum.${recordedPayload.action}: proposalId must be a non-empty string, got ${typeof p}` };
  }
  if (p.length > PROPOSAL_ID_MAX) {
    return { violated: true, detail: `quorum.${recordedPayload.action}: proposalId length ${p.length} exceeds ${PROPOSAL_ID_MAX}` };
  }
  return 'pass';
};

/** propose: type must be a non-empty bounded string when present. */
const quorumProposeTypeWellFormedWhenPresent: Invariant<HiveMindConsensusPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'propose') return 'pass';
  if (recordedPayload.strategy !== 'quorum') return 'pass';
  const t = recordedPayload.type;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `quorum.propose: type must be a non-empty string when present, got ${typeof t}` };
  }
  if (t.length > TYPE_MAX) {
    return { violated: true, detail: `quorum.propose: type length ${t.length} exceeds ${TYPE_MAX}` };
  }
  return 'pass';
};

export const quorumConsensusInvariants: ReadonlyArray<Invariant<HiveMindConsensusPayload>> = [
  quorumProposeQuorumPresetEnum,
  quorumVoteVoterIdWellFormed,
  quorumVoteValueIsBoolean,
  quorumProposalIdWellFormed,
  quorumProposeTypeWellFormedWhenPresent,
];
