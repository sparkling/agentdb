// charter: mutation-invariants
// agent_execute mutation invariants (ADR-0181 §H).
// Persistence half of an agent execution: agentId + post-execution status +
// optional taskCountDelta. Validation here guards the write against malformed
// records once the cli wraps execution result handling.

import type { Invariant } from '../../registration.js';
import type { AgentExecutePayload } from '../../handlers/agents/execute.js';

export type { AgentExecutePayload };

const AGENT_ID_MAX = 500;
const VALID_STATUSES = new Set(['idle', 'busy', 'terminated']);

/** agentId must be a non-empty string ≤500 chars. */
const agentIdWellFormed: Invariant<AgentExecutePayload> = ({ recordedPayload }) => {
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
const agentIdEquality: Invariant<AgentExecutePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.agentId !== recordedPayload.agentId) {
    return {
      violated: true,
      detail: `agentId divergence: intent='${callerIntent.agentId}' recorded='${recordedPayload.agentId}'`,
    };
  }
  return 'pass';
};

/** status must be one of {idle, busy, terminated}. The post-execution write
 *  flips status; an unknown value would corrupt the AgentRecord union. */
const statusInEnum: Invariant<AgentExecutePayload> = ({ recordedPayload }) => {
  const s = recordedPayload.status;
  if (typeof s !== 'string' || !VALID_STATUSES.has(s)) {
    return { violated: true, detail: `status must be one of {idle,busy,terminated}, got ${JSON.stringify(s)}` };
  }
  return 'pass';
};

/** taskCountDelta (optional) must be a finite integer when present.
 *  Negative deltas are permitted (a future rollback path could decrement). */
const taskCountDeltaFiniteWhenPresent: Invariant<AgentExecutePayload> = ({ recordedPayload }) => {
  const d = recordedPayload.taskCountDelta;
  if (d === undefined || d === null) return 'pass';
  if (typeof d !== 'number' || !Number.isFinite(d) || !Number.isInteger(d)) {
    return { violated: true, detail: `taskCountDelta must be a finite integer when present, got ${String(d)}` };
  }
  return 'pass';
};

export const executeInvariants: ReadonlyArray<Invariant<AgentExecutePayload>> = [
  agentIdWellFormed,
  agentIdEquality,
  statusInEnum,
  taskCountDeltaFiniteWhenPresent,
];
