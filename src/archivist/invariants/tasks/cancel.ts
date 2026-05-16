// charter: mutation-invariants
// task_cancel mutation invariants (ADR-0181 §H).

import type { Invariant } from '../../registration.js';
import type { TaskCancelPayload } from '../../handlers/tasks/cancel.js';

export type { TaskCancelPayload };

const TASK_ID_MAX = 500;
const REASON_MAX = 2_000;

const taskIdWellFormed: Invariant<TaskCancelPayload> = ({ recordedPayload }) => {
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
const taskIdEquality: Invariant<TaskCancelPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.taskId !== recordedPayload.taskId) {
    return {
      violated: true,
      detail: `taskId divergence: intent='${callerIntent.taskId}' recorded='${recordedPayload.taskId}'`,
    };
  }
  return 'pass';
};

const reasonBoundedWhenPresent: Invariant<TaskCancelPayload> = ({ recordedPayload }) => {
  const r = recordedPayload.reason;
  if (r === undefined || r === null) return 'pass';
  if (typeof r !== 'string') {
    return { violated: true, detail: `reason must be a string when present, got ${typeof r}` };
  }
  if (r.length > REASON_MAX) {
    return { violated: true, detail: `reason length ${r.length} exceeds max ${REASON_MAX}` };
  }
  return 'pass';
};

export const cancelInvariants: ReadonlyArray<Invariant<TaskCancelPayload>> = [
  taskIdWellFormed,
  taskIdEquality,
  reasonBoundedWhenPresent,
];
