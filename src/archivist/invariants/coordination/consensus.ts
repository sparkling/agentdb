// charter: mutation-invariants
// coordination_consensus mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler dispatches mixed-mode actions (status / propose / vote / commit) against
// `.claude-flow/coordination/store.json`. Out-of-enum action / strategy / vote, out-of-range
// term, or empty proposalId / voterId would corrupt the consensus subtree.

import type { Invariant } from '../../registration.js';
import type { CoordinationConsensusPayload } from '../../handlers/coordination/consensus.js';

export type { CoordinationConsensusPayload };

const VALID_ACTIONS = new Set(['status', 'propose', 'vote', 'commit']);
const VALID_STRATEGIES = new Set(['bft', 'raft', 'quorum']);
const VALID_QUORUM_PRESETS = new Set(['unanimous', 'majority', 'supermajority']);
const VALID_VOTES = new Set(['accept', 'reject']);
const ID_MAX = 200;

/** action must be one of {status, propose, vote, commit} when present. */
const actionInEnum: Invariant<CoordinationConsensusPayload> = ({ recordedPayload }) => {
  const a = recordedPayload.action;
  if (a === undefined) return 'pass';
  if (!VALID_ACTIONS.has(a as string)) {
    return { violated: true, detail: `action must be one of {status,propose,vote,commit}, got ${JSON.stringify(a)}` };
  }
  return 'pass';
};

/** strategy must be one of {bft, raft, quorum} when present. */
const strategyInEnum: Invariant<CoordinationConsensusPayload> = ({ recordedPayload }) => {
  const s = recordedPayload.strategy;
  if (s === undefined) return 'pass';
  if (!VALID_STRATEGIES.has(s as string)) {
    return { violated: true, detail: `strategy must be one of {bft,raft,quorum}, got ${JSON.stringify(s)}` };
  }
  return 'pass';
};

/** quorumPreset must be one of {unanimous, majority, supermajority} when present. */
const quorumPresetInEnum: Invariant<CoordinationConsensusPayload> = ({ recordedPayload }) => {
  const q = recordedPayload.quorumPreset;
  if (q === undefined) return 'pass';
  if (!VALID_QUORUM_PRESETS.has(q as string)) {
    return { violated: true, detail: `quorumPreset must be one of {unanimous,majority,supermajority}, got ${JSON.stringify(q)}` };
  }
  return 'pass';
};

/** vote must be 'accept' or 'reject' when present. */
const voteInEnum: Invariant<CoordinationConsensusPayload> = ({ recordedPayload }) => {
  const v = recordedPayload.vote;
  if (v === undefined) return 'pass';
  if (!VALID_VOTES.has(v as string)) {
    return { violated: true, detail: `vote must be one of {accept,reject}, got ${JSON.stringify(v)}` };
  }
  return 'pass';
};

/** proposalId, when present, must be a non-empty string ≤200 chars. The
 *  substrate keys consensus.pending/history by this id; an empty value would
 *  produce an unaddressable record. */
const proposalIdWellFormed: Invariant<CoordinationConsensusPayload> = ({ recordedPayload }) => {
  const id = recordedPayload.proposalId;
  if (id === undefined) return 'pass';
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `proposalId must be a non-empty string when present, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `proposalId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** voterId, when present, must be a non-empty string ≤200 chars. The
 *  byzantine-detection logic indexes per-voter on every proposal. */
const voterIdWellFormed: Invariant<CoordinationConsensusPayload> = ({ recordedPayload }) => {
  const id = recordedPayload.voterId;
  if (id === undefined) return 'pass';
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `voterId must be a non-empty string when present, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `voterId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** term must be a finite non-negative integer when present (Raft single-leader
 *  log epoch — negative / non-integer / Infinity would alias term records). */
const termNonNegativeInteger: Invariant<CoordinationConsensusPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.term;
  if (t === undefined) return 'pass';
  if (typeof t !== 'number' || !Number.isFinite(t) || !Number.isInteger(t)) {
    return { violated: true, detail: `term must be a finite integer, got ${String(t)}` };
  }
  if (t < 0) {
    return { violated: true, detail: `term must be >= 0, got ${t}` };
  }
  return 'pass';
};

/** action identity — TAUTOLOGY TODAY: dispatch passes the same payload object
 *  to caller-intent and recorded slots. Ships as contract spec for the future
 *  cli boundary flip per ADR-0181 §H. */
const actionEquality: Invariant<CoordinationConsensusPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.action !== recordedPayload.action) {
    return { violated: true, detail: `action divergence: intent='${String(callerIntent.action)}' recorded='${String(recordedPayload.action)}'` };
  }
  return 'pass';
};

/** strategy identity — TAUTOLOGY TODAY (see actionEquality). */
const strategyEquality: Invariant<CoordinationConsensusPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.strategy !== recordedPayload.strategy) {
    return { violated: true, detail: `strategy divergence: intent='${String(callerIntent.strategy)}' recorded='${String(recordedPayload.strategy)}'` };
  }
  return 'pass';
};

export const consensusInvariants: ReadonlyArray<Invariant<CoordinationConsensusPayload>> = [
  actionInEnum,
  strategyInEnum,
  quorumPresetInEnum,
  voteInEnum,
  proposalIdWellFormed,
  voterIdWellFormed,
  termNonNegativeInteger,
  actionEquality,
  strategyEquality,
];
