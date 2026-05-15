// charter: mutation-invariants
// agentdb_feedback mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// Feedback writes fan out to LearningSystem + ReasoningBank; an out-of-range quality
// or empty taskId would corrupt the learning trajectory and the ranked recall index.

import type { Invariant } from '../../registration.js';
import type { AgentdbFeedbackPayload } from '../../handlers/agentdb/feedback.js';

export type { AgentdbFeedbackPayload };

const TASK_ID_MAX = 500;
const AGENT_MAX = 200;

/** taskId must be a non-empty string ≤500 chars. The cli boundary enforces this
 *  too; we re-check at the dispatch boundary so non-cli callers can't sneak an
 *  empty/oversized taskId into the audit chain. */
const taskIdWellFormed: Invariant<AgentdbFeedbackPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.taskId;
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `taskId must be a non-empty string, got ${typeof t} length=${(t as string)?.length ?? 0}` };
  }
  if (t.length > TASK_ID_MAX) {
    return { violated: true, detail: `taskId length ${t.length} exceeds max ${TASK_ID_MAX}` };
  }
  return 'pass';
};

/** taskId identity — substrate routes per taskId; divergence is a placement bug. */
const taskIdEquality: Invariant<AgentdbFeedbackPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.taskId !== recordedPayload.taskId) {
    return {
      violated: true,
      detail: `taskId divergence: intent='${callerIntent.taskId}' recorded='${recordedPayload.taskId}'`,
    };
  }
  return 'pass';
};

/** quality in [0,1] when present. */
const qualityInRange: Invariant<AgentdbFeedbackPayload> = ({ recordedPayload }) => {
  const q = recordedPayload.quality;
  if (q === undefined || q === null) return 'pass';
  if (typeof q !== 'number' || !Number.isFinite(q)) {
    return { violated: true, detail: `quality must be a finite number, got ${String(q)}` };
  }
  if (q < 0 || q > 1) {
    return { violated: true, detail: `quality must be in [0,1], got ${q}` };
  }
  return 'pass';
};

/** agent (optional) ≤200 chars when present. */
const agentLengthBounded: Invariant<AgentdbFeedbackPayload> = ({ recordedPayload }) => {
  const a = recordedPayload.agent;
  if (a === undefined || a === null) return 'pass';
  if (typeof a !== 'string') {
    return { violated: true, detail: `agent must be a string when present, got ${typeof a}` };
  }
  if (a.length > AGENT_MAX) {
    return { violated: true, detail: `agent length ${a.length} exceeds max ${AGENT_MAX}` };
  }
  return 'pass';
};

export const feedbackInvariants: ReadonlyArray<Invariant<AgentdbFeedbackPayload>> = [
  taskIdWellFormed,
  taskIdEquality,
  qualityInRange,
  agentLengthBounded,
];
