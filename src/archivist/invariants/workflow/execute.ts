// charter: mutation-invariants
// workflow_execute mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { WorkflowExecutePayload } from '../../handlers/workflow/execute.js';

export type { WorkflowExecutePayload };

const ID_MAX = 200;

const workflowIdWellFormed: Invariant<WorkflowExecutePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.workflowId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `workflowId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `workflowId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** startFromStep, when present, must be a finite non-negative integer. */
const startFromStepNonNegative: Invariant<WorkflowExecutePayload> = ({ recordedPayload }) => {
  const s = recordedPayload.startFromStep;
  if (s === undefined) return 'pass';
  if (typeof s !== 'number' || !Number.isFinite(s) || !Number.isInteger(s)) {
    return { violated: true, detail: `startFromStep must be a finite integer, got ${String(s)}` };
  }
  if (s < 0) {
    return { violated: true, detail: `startFromStep must be >= 0, got ${s}` };
  }
  return 'pass';
};

const workflowIdEquality: Invariant<WorkflowExecutePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.workflowId !== recordedPayload.workflowId) {
    return { violated: true, detail: `workflowId divergence: intent='${callerIntent.workflowId}' recorded='${recordedPayload.workflowId}'` };
  }
  return 'pass';
};

export const executeInvariants: ReadonlyArray<Invariant<WorkflowExecutePayload>> = [
  workflowIdWellFormed,
  startFromStepNonNegative,
  workflowIdEquality,
];
