// charter: mutation-invariants
// task_list invariants (ADR-0181 §H).
// Registered as a mutation handler per ADR-0180 Phase 5 convention. The
// handler runs under withWrite so the read participates in the audit chain
// (intent → applied with no real mutation). Invariants here guard the
// filter shape.

import type { Invariant } from '../../registration.js';
import type { TaskListPayload } from '../../handlers/tasks/list.js';

export type { TaskListPayload };

const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'critical']);
const STR_MAX = 500;
const LIMIT_MAX = 10_000;

const statusBoundedWhenPresent: Invariant<TaskListPayload> = ({ recordedPayload }) => {
  const s = recordedPayload.status;
  if (s === undefined || s === null) return 'pass';
  if (typeof s !== 'string') {
    return { violated: true, detail: `status must be a string when present, got ${typeof s}` };
  }
  if (s.length > STR_MAX) {
    return { violated: true, detail: `status length ${s.length} exceeds max ${STR_MAX}` };
  }
  return 'pass';
};

const typeBoundedWhenPresent: Invariant<TaskListPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.type;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'string') {
    return { violated: true, detail: `type must be a string when present, got ${typeof t}` };
  }
  if (t.length > STR_MAX) {
    return { violated: true, detail: `type length ${t.length} exceeds max ${STR_MAX}` };
  }
  return 'pass';
};

const assignedToBoundedWhenPresent: Invariant<TaskListPayload> = ({ recordedPayload }) => {
  const a = recordedPayload.assignedTo;
  if (a === undefined || a === null) return 'pass';
  if (typeof a !== 'string') {
    return { violated: true, detail: `assignedTo must be a string when present, got ${typeof a}` };
  }
  if (a.length > STR_MAX) {
    return { violated: true, detail: `assignedTo length ${a.length} exceeds max ${STR_MAX}` };
  }
  return 'pass';
};

const priorityInEnumWhenPresent: Invariant<TaskListPayload> = ({ recordedPayload }) => {
  const p = recordedPayload.priority;
  if (p === undefined || p === null) return 'pass';
  if (typeof p !== 'string' || !VALID_PRIORITIES.has(p)) {
    return { violated: true, detail: `priority filter must be one of {low,normal,high,critical}, got ${JSON.stringify(p)}` };
  }
  return 'pass';
};

const limitInRangeWhenPresent: Invariant<TaskListPayload> = ({ recordedPayload }) => {
  const l = recordedPayload.limit;
  if (l === undefined || l === null) return 'pass';
  if (typeof l !== 'number' || !Number.isFinite(l) || !Number.isInteger(l)) {
    return { violated: true, detail: `limit must be a finite integer when present, got ${String(l)}` };
  }
  if (l < 1 || l > LIMIT_MAX) {
    return { violated: true, detail: `limit must be in [1,${LIMIT_MAX}], got ${l}` };
  }
  return 'pass';
};

export const listInvariants: ReadonlyArray<Invariant<TaskListPayload>> = [
  statusBoundedWhenPresent,
  typeBoundedWhenPresent,
  assignedToBoundedWhenPresent,
  priorityInEnumWhenPresent,
  limitInRangeWhenPresent,
];
