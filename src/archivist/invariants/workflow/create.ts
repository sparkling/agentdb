// charter: mutation-invariants
// workflow_create mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler already throws on empty name / empty steps (ADR-0094 P11/P12).
// Invariants formalize that contract for the audit chain plus extra range
// checks the handler doesn't validate (oversized arrays, bad step types).

import type { Invariant } from '../../registration.js';
import type { WorkflowCreatePayload } from '../../handlers/workflow/create.js';

export type { WorkflowCreatePayload };

const NAME_MAX = 500;
const DESCRIPTION_MAX = 10_000;
const STEPS_MAX = 1000;
const VALID_STEP_TYPES = new Set(['task', 'condition', 'parallel', 'loop', 'wait']);

/** name must be a non-empty string ≤500 chars. */
const nameNonEmpty: Invariant<WorkflowCreatePayload> = ({ recordedPayload }) => {
  const n = recordedPayload.name;
  if (typeof n !== 'string' || n.length === 0) {
    return { violated: true, detail: `name must be a non-empty string, got ${typeof n} length=${(n as string)?.length ?? 0}` };
  }
  if (n.length > NAME_MAX) {
    return { violated: true, detail: `name length ${n.length} exceeds max ${NAME_MAX}` };
  }
  return 'pass';
};

/** name identity — TAUTOLOGY TODAY. */
const nameEquality: Invariant<WorkflowCreatePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.name !== recordedPayload.name) {
    return { violated: true, detail: `name divergence: intent='${callerIntent.name}' recorded='${recordedPayload.name}'` };
  }
  return 'pass';
};

/** description, when present, must be a string ≤10KB. */
const descriptionBounded: Invariant<WorkflowCreatePayload> = ({ recordedPayload }) => {
  const d = recordedPayload.description;
  if (d === undefined) return 'pass';
  if (typeof d !== 'string') {
    return { violated: true, detail: `description must be a string when present, got ${typeof d}` };
  }
  if (d.length > DESCRIPTION_MAX) {
    return { violated: true, detail: `description length ${d.length} exceeds max ${DESCRIPTION_MAX}` };
  }
  return 'pass';
};

/** steps must be a non-empty array ≤1000; each step's type must be in enum. */
const stepsWellFormed: Invariant<WorkflowCreatePayload> = ({ recordedPayload }) => {
  const s = recordedPayload.steps;
  if (!Array.isArray(s)) {
    return { violated: true, detail: `steps must be an array, got ${typeof s}` };
  }
  if (s.length === 0) {
    return { violated: true, detail: `steps must be non-empty` };
  }
  if (s.length > STEPS_MAX) {
    return { violated: true, detail: `steps length ${s.length} exceeds max ${STEPS_MAX}` };
  }
  for (let i = 0; i < s.length; i++) {
    const t = s[i]?.type;
    if (t !== undefined && !VALID_STEP_TYPES.has(t as string)) {
      return { violated: true, detail: `steps[${i}].type must be one of {task,condition,parallel,loop,wait}, got ${JSON.stringify(t)}` };
    }
  }
  return 'pass';
};

export const createInvariants: ReadonlyArray<Invariant<WorkflowCreatePayload>> = [
  nameNonEmpty,
  nameEquality,
  descriptionBounded,
  stepsWellFormed,
];
