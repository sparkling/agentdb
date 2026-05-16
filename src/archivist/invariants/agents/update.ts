// charter: mutation-invariants
// agent_update mutation invariants (ADR-0181 §H).
// Sparse patch of an existing AgentRecord. The handler shallow-merges; out-of-
// range values poison the next read (health NaN, negative taskCount, unknown
// status). Validation runs at the dispatch boundary so a non-cli caller cannot
// sneak malformed fields through.

import type { Invariant } from '../../registration.js';
import type { AgentUpdatePayload } from '../../handlers/agents/update.js';

export type { AgentUpdatePayload };

const AGENT_ID_MAX = 500;
const VALID_STATUSES = new Set(['idle', 'busy', 'terminated']);

/** agentId must be a non-empty string ≤500 chars. */
const agentIdWellFormed: Invariant<AgentUpdatePayload> = ({ recordedPayload }) => {
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
const agentIdEquality: Invariant<AgentUpdatePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.agentId !== recordedPayload.agentId) {
    return {
      violated: true,
      detail: `agentId divergence: intent='${callerIntent.agentId}' recorded='${recordedPayload.agentId}'`,
    };
  }
  return 'pass';
};

/** status (optional) must be one of {idle, busy, terminated} when present. */
const statusInEnumWhenPresent: Invariant<AgentUpdatePayload> = ({ recordedPayload }) => {
  const s = recordedPayload.status;
  if (s === undefined || s === null) return 'pass';
  if (typeof s !== 'string' || !VALID_STATUSES.has(s)) {
    return { violated: true, detail: `status must be one of {idle,busy,terminated} when present, got ${JSON.stringify(s)}` };
  }
  return 'pass';
};

/** health (optional) must be finite ∈ [0,1] when present. */
const healthInRangeWhenPresent: Invariant<AgentUpdatePayload> = ({ recordedPayload }) => {
  const h = recordedPayload.health;
  if (h === undefined || h === null) return 'pass';
  if (typeof h !== 'number' || !Number.isFinite(h)) {
    return { violated: true, detail: `health must be a finite number when present, got ${String(h)}` };
  }
  if (h < 0 || h > 1) {
    return { violated: true, detail: `health must be in [0,1] when present, got ${h}` };
  }
  return 'pass';
};

/** taskCount (optional) must be a non-negative integer when present. */
const taskCountNonNegativeWhenPresent: Invariant<AgentUpdatePayload> = ({ recordedPayload }) => {
  const c = recordedPayload.taskCount;
  if (c === undefined || c === null) return 'pass';
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || !Number.isInteger(c)) {
    return { violated: true, detail: `taskCount must be a non-negative integer when present, got ${String(c)}` };
  }
  return 'pass';
};

export const updateInvariants: ReadonlyArray<Invariant<AgentUpdatePayload>> = [
  agentIdWellFormed,
  agentIdEquality,
  statusInEnumWhenPresent,
  healthInRangeWhenPresent,
  taskCountNonNegativeWhenPresent,
];
