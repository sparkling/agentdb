// charter: mutation-invariants
// task_complete mutation invariants (ADR-0181 §H).
// Two-store write (tasks + hive-mind_agents). Guards the taskId at the
// dispatch boundary; result shape stays open per cli contract.

import type { Invariant } from '../../registration.js';
import type { TaskCompletePayload } from '../../handlers/tasks/complete.js';

export type { TaskCompletePayload };

const TASK_ID_MAX = 500;

const taskIdWellFormed: Invariant<TaskCompletePayload> = ({ recordedPayload }) => {
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
const taskIdEquality: Invariant<TaskCompletePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.taskId !== recordedPayload.taskId) {
    return {
      violated: true,
      detail: `taskId divergence: intent='${callerIntent.taskId}' recorded='${recordedPayload.taskId}'`,
    };
  }
  return 'pass';
};

/** result (optional) must be a plain object (not array, not null) when present. */
const resultObjectWhenPresent: Invariant<TaskCompletePayload> = ({ recordedPayload }) => {
  const r = recordedPayload.result;
  if (r === undefined || r === null) return 'pass';
  if (typeof r !== 'object' || Array.isArray(r)) {
    return { violated: true, detail: `result must be a plain object when present, got ${Array.isArray(r) ? 'array' : typeof r}` };
  }
  return 'pass';
};

export const completeInvariants: ReadonlyArray<Invariant<TaskCompletePayload>> = [
  taskIdWellFormed,
  taskIdEquality,
  resultObjectWhenPresent,
];
