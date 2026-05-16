// charter: mutation-invariants
// task_update mutation invariants (ADR-0181 §H).

import type { Invariant } from '../../registration.js';
import type { TaskUpdatePayload } from '../../handlers/tasks/update.js';

export type { TaskUpdatePayload };

const TASK_ID_MAX = 500;
const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed', 'failed', 'cancelled']);

const taskIdWellFormed: Invariant<TaskUpdatePayload> = ({ recordedPayload }) => {
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
const taskIdEquality: Invariant<TaskUpdatePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.taskId !== recordedPayload.taskId) {
    return {
      violated: true,
      detail: `taskId divergence: intent='${callerIntent.taskId}' recorded='${recordedPayload.taskId}'`,
    };
  }
  return 'pass';
};

/** status (optional) must be one of the TaskRecord status union when present. */
const statusInEnumWhenPresent: Invariant<TaskUpdatePayload> = ({ recordedPayload }) => {
  const s = recordedPayload.status;
  if (s === undefined || s === null) return 'pass';
  if (typeof s !== 'string' || !VALID_STATUSES.has(s)) {
    return { violated: true, detail: `status must be a TaskRecord status, got ${JSON.stringify(s)}` };
  }
  return 'pass';
};

/** progress (optional) must be ∈ [0, 100] when present. The handler clamps;
 *  this invariant rejects NaN/Infinity. */
const progressInRangeWhenPresent: Invariant<TaskUpdatePayload> = ({ recordedPayload }) => {
  const p = recordedPayload.progress;
  if (p === undefined || p === null) return 'pass';
  if (typeof p !== 'number' || !Number.isFinite(p)) {
    return { violated: true, detail: `progress must be a finite number when present, got ${String(p)}` };
  }
  if (p < 0 || p > 100) {
    return { violated: true, detail: `progress must be in [0,100], got ${p}` };
  }
  return 'pass';
};

/** assignTo (optional) must be a non-empty string array when present. */
const assignToWellFormedWhenPresent: Invariant<TaskUpdatePayload> = ({ recordedPayload }) => {
  const a = recordedPayload.assignTo;
  if (a === undefined || a === null) return 'pass';
  if (!Array.isArray(a)) {
    return { violated: true, detail: `assignTo must be an array when present, got ${typeof a}` };
  }
  for (const id of a) {
    if (typeof id !== 'string' || id.length === 0) {
      return { violated: true, detail: `assignTo entries must be non-empty strings, got ${JSON.stringify(id)}` };
    }
  }
  return 'pass';
};

export const updateInvariants: ReadonlyArray<Invariant<TaskUpdatePayload>> = [
  taskIdWellFormed,
  taskIdEquality,
  statusInEnumWhenPresent,
  progressInRangeWhenPresent,
  assignToWellFormedWhenPresent,
];
