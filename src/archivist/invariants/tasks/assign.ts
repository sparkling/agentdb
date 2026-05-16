// charter: mutation-invariants
// task_assign mutation invariants (ADR-0181 §H).

import type { Invariant } from '../../registration.js';
import type { TaskAssignPayload } from '../../handlers/tasks/assign.js';

export type { TaskAssignPayload };

const TASK_ID_MAX = 500;

const taskIdWellFormed: Invariant<TaskAssignPayload> = ({ recordedPayload }) => {
  const id = recordedPayload.taskId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `taskId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > TASK_ID_MAX) {
    return { violated: true, detail: `taskId length ${id.length} exceeds max ${TASK_ID_MAX}` };
  }
  return 'pass';
};

/** taskId identity — TAUTOLOGY today; ships as contract spec. */
const taskIdEquality: Invariant<TaskAssignPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.taskId !== recordedPayload.taskId) {
    return {
      violated: true,
      detail: `taskId divergence: intent='${callerIntent.taskId}' recorded='${recordedPayload.taskId}'`,
    };
  }
  return 'pass';
};

/** agentIds (optional) must be a string array when present. */
const agentIdsWellFormedWhenPresent: Invariant<TaskAssignPayload> = ({ recordedPayload }) => {
  const ids = recordedPayload.agentIds;
  if (ids === undefined || ids === null) return 'pass';
  if (!Array.isArray(ids)) {
    return { violated: true, detail: `agentIds must be an array when present, got ${typeof ids}` };
  }
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) {
      return { violated: true, detail: `agentIds entries must be non-empty strings, got ${JSON.stringify(id)}` };
    }
  }
  return 'pass';
};

const unassignBooleanWhenPresent: Invariant<TaskAssignPayload> = ({ recordedPayload }) => {
  const u = recordedPayload.unassign;
  if (u === undefined || u === null) return 'pass';
  if (typeof u !== 'boolean') {
    return { violated: true, detail: `unassign must be a boolean when present, got ${typeof u}` };
  }
  return 'pass';
};

export const assignInvariants: ReadonlyArray<Invariant<TaskAssignPayload>> = [
  taskIdWellFormed,
  taskIdEquality,
  agentIdsWellFormedWhenPresent,
  unassignBooleanWhenPresent,
];
