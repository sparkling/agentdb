// charter: mutation-invariants
// task_status invariants (ADR-0181 §H).
// Registered as a mutation handler per ADR-0180 Phase 5 convention. The
// handler runs under withWrite so the read participates in the audit chain
// (intent → applied with no real mutation). Invariants here guard the
// taskId shape at the dispatch boundary.

import type { Invariant } from '../../registration.js';
import type { TaskStatusPayload } from '../../handlers/tasks/status.js';

export type { TaskStatusPayload };

const TASK_ID_MAX = 500;

const taskIdWellFormed: Invariant<TaskStatusPayload> = ({ recordedPayload }) => {
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
const taskIdEquality: Invariant<TaskStatusPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.taskId !== recordedPayload.taskId) {
    return {
      violated: true,
      detail: `taskId divergence: intent='${callerIntent.taskId}' recorded='${recordedPayload.taskId}'`,
    };
  }
  return 'pass';
};

export const statusInvariants: ReadonlyArray<Invariant<TaskStatusPayload>> = [
  taskIdWellFormed,
  taskIdEquality,
];
