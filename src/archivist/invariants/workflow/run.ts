// charter: mutation-invariants
// workflow_run mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// Template defaults to 'custom'; the handler builds steps from template stages.

import type { Invariant } from '../../registration.js';
import type { WorkflowRunPayload } from '../../handlers/workflow/run.js';

export type { WorkflowRunPayload };

const NAME_MAX = 200;
const TASK_MAX = 10_000;
const MAX_AGENTS_CAP = 256;

/** template, when present, must be a non-empty string. */
const templateWellFormed: Invariant<WorkflowRunPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.template;
  if (t === undefined) return 'pass';
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `template must be a non-empty string when present, got ${typeof t} length=${(t as string)?.length ?? 0}` };
  }
  if (t.length > NAME_MAX) {
    return { violated: true, detail: `template length ${t.length} exceeds max ${NAME_MAX}` };
  }
  return 'pass';
};

/** task, when present, must be a string ≤10KB. */
const taskBounded: Invariant<WorkflowRunPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.task;
  if (t === undefined) return 'pass';
  if (typeof t !== 'string') {
    return { violated: true, detail: `task must be a string when present, got ${typeof t}` };
  }
  if (t.length > TASK_MAX) {
    return { violated: true, detail: `task length ${t.length} exceeds max ${TASK_MAX}` };
  }
  return 'pass';
};

/** options.maxAgents, when present, must be a finite positive integer ≤256. */
const maxAgentsInRange: Invariant<WorkflowRunPayload> = ({ recordedPayload }) => {
  const m = recordedPayload.options?.maxAgents;
  if (m === undefined) return 'pass';
  if (typeof m !== 'number' || !Number.isFinite(m) || !Number.isInteger(m)) {
    return { violated: true, detail: `options.maxAgents must be a finite integer, got ${String(m)}` };
  }
  if (m < 1 || m > MAX_AGENTS_CAP) {
    return { violated: true, detail: `options.maxAgents must be in [1, ${MAX_AGENTS_CAP}], got ${m}` };
  }
  return 'pass';
};

/** options.timeout, when present, must be a finite non-negative number. */
const timeoutNonNegative: Invariant<WorkflowRunPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.options?.timeout;
  if (t === undefined) return 'pass';
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    return { violated: true, detail: `options.timeout must be a finite number, got ${String(t)}` };
  }
  if (t < 0) {
    return { violated: true, detail: `options.timeout must be >= 0, got ${t}` };
  }
  return 'pass';
};

export const runInvariants: ReadonlyArray<Invariant<WorkflowRunPayload>> = [
  templateWellFormed,
  taskBounded,
  maxAgentsInRange,
  timeoutNonNegative,
];
