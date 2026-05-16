// charter: mutation-invariants
// daa_agent_adapt mutation invariants (ADR-0181 §H).
// Adapt bumps the agent's metrics — adaptations++, successRate moving avg.
// A NaN/out-of-range performanceScore poisons the running average forever.

import type { Invariant } from '../../registration.js';
import type { DaaAgentAdaptPayload } from '../../handlers/daa/agent-adapt.js';

export type { DaaAgentAdaptPayload };

const AGENT_ID_MAX = 500;
const FEEDBACK_MAX = 10_000;

const agentIdWellFormed: Invariant<DaaAgentAdaptPayload> = ({ recordedPayload }) => {
  const id = recordedPayload.agentId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `agentId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > AGENT_ID_MAX) {
    return { violated: true, detail: `agentId length ${id.length} exceeds max ${AGENT_ID_MAX}` };
  }
  return 'pass';
};

/** agentId identity — TAUTOLOGY today; ships as contract spec. */
const agentIdEquality: Invariant<DaaAgentAdaptPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.agentId !== recordedPayload.agentId) {
    return {
      violated: true,
      detail: `agentId divergence: intent='${callerIntent.agentId}' recorded='${recordedPayload.agentId}'`,
    };
  }
  return 'pass';
};

/** performanceScore (optional) must be finite ∈ [0, 1] when present. The
 *  handler folds it into a running average; NaN/Infinity makes successRate
 *  unrecoverable. */
const performanceScoreInRangeWhenPresent: Invariant<DaaAgentAdaptPayload> = ({ recordedPayload }) => {
  const s = recordedPayload.performanceScore;
  if (s === undefined || s === null) return 'pass';
  if (typeof s !== 'number' || !Number.isFinite(s)) {
    return { violated: true, detail: `performanceScore must be a finite number when present, got ${String(s)}` };
  }
  if (s < 0 || s > 1) {
    return { violated: true, detail: `performanceScore must be in [0,1], got ${s}` };
  }
  return 'pass';
};

const feedbackBoundedWhenPresent: Invariant<DaaAgentAdaptPayload> = ({ recordedPayload }) => {
  const f = recordedPayload.feedback;
  if (f === undefined || f === null) return 'pass';
  if (typeof f !== 'string') {
    return { violated: true, detail: `feedback must be a string when present, got ${typeof f}` };
  }
  if (f.length > FEEDBACK_MAX) {
    return { violated: true, detail: `feedback length ${f.length} exceeds max ${FEEDBACK_MAX}` };
  }
  return 'pass';
};

const suggestionsWellFormedWhenPresent: Invariant<DaaAgentAdaptPayload> = ({ recordedPayload }) => {
  const s = recordedPayload.suggestions;
  if (s === undefined || s === null) return 'pass';
  if (!Array.isArray(s)) {
    return { violated: true, detail: `suggestions must be an array when present, got ${typeof s}` };
  }
  for (const sug of s) {
    if (typeof sug !== 'string') {
      return { violated: true, detail: `suggestions entries must be strings, got ${JSON.stringify(sug)}` };
    }
  }
  return 'pass';
};

export const agentAdaptInvariants: ReadonlyArray<Invariant<DaaAgentAdaptPayload>> = [
  agentIdWellFormed,
  agentIdEquality,
  performanceScoreInRangeWhenPresent,
  feedbackBoundedWhenPresent,
  suggestionsWellFormedWhenPresent,
];
