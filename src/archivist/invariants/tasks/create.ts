// charter: mutation-invariants
// task_create mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// task_create writes to the FS-JSON `tasks` store; an empty `type`, oversized
// `description`, or out-of-enum `priority` would either crash downstream
// consumers (task_list filters on type/priority) or break the schema contract
// the cli surface advertises.

import type { Invariant } from '../../registration.js';
import type { TaskCreatePayload } from '../../handlers/tasks/create.js';

export type { TaskCreatePayload };

const DESCRIPTION_MAX = 10_000;
const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'critical']);

/** type must be a non-empty string. */
const typeNonEmpty: Invariant<TaskCreatePayload> = ({ recordedPayload }) => {
  const t = recordedPayload.type;
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `type must be a non-empty string, got ${typeof t} length=${(t as string)?.length ?? 0}` };
  }
  return 'pass';
};

/** type identity. */
const typeEquality: Invariant<TaskCreatePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.type !== recordedPayload.type) {
    return {
      violated: true,
      detail: `type divergence: intent='${callerIntent.type}' recorded='${recordedPayload.type}'`,
    };
  }
  return 'pass';
};

/** description must be a string ≤10KB. Empty is permitted (the cli surface
 *  treats description as optional in practice — many callers pass ''). */
const descriptionBounded: Invariant<TaskCreatePayload> = ({ recordedPayload }) => {
  const d = recordedPayload.description;
  if (typeof d !== 'string') {
    return { violated: true, detail: `description must be a string, got ${typeof d}` };
  }
  if (d.length > DESCRIPTION_MAX) {
    return { violated: true, detail: `description length ${d.length} exceeds max ${DESCRIPTION_MAX}` };
  }
  return 'pass';
};

/** priority must be one of {low, normal, high, critical} when present. The
 *  handler defaults to 'normal' inside the body; the recorded payload still
 *  carries the original — divergence indicates a bypassed default. */
const priorityInEnum: Invariant<TaskCreatePayload> = ({ recordedPayload }) => {
  const p = recordedPayload.priority;
  if (p === undefined || p === null) return 'pass';
  if (!VALID_PRIORITIES.has(p as string)) {
    return { violated: true, detail: `priority must be one of {low,normal,high,critical}, got ${JSON.stringify(p)}` };
  }
  return 'pass';
};

/** Caller-supplied taskId, when present, must be a non-empty string. The cli
 *  pre-mints to defeat the racy pre/post diff (handler header comment); a
 *  null/empty caller-supplied id would land an unaddressable record. */
const taskIdWellFormedWhenPresent: Invariant<TaskCreatePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.taskId;
  if (id === undefined || id === null) return 'pass';
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `taskId must be a non-empty string when present, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  return 'pass';
};

export const createInvariants: ReadonlyArray<Invariant<TaskCreatePayload>> = [
  typeNonEmpty,
  typeEquality,
  descriptionBounded,
  priorityInEnum,
  taskIdWellFormedWhenPresent,
];
