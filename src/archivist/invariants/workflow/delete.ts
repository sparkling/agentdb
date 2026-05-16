// charter: mutation-invariants
// workflow_delete mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { WorkflowDeletePayload } from '../../handlers/workflow/delete.js';

export type { WorkflowDeletePayload };

const ID_MAX = 200;

const workflowIdWellFormed: Invariant<WorkflowDeletePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.workflowId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `workflowId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `workflowId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

const workflowIdEquality: Invariant<WorkflowDeletePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.workflowId !== recordedPayload.workflowId) {
    return { violated: true, detail: `workflowId divergence: intent='${callerIntent.workflowId}' recorded='${recordedPayload.workflowId}'` };
  }
  return 'pass';
};

export const deleteInvariants: ReadonlyArray<Invariant<WorkflowDeletePayload>> = [
  workflowIdWellFormed,
  workflowIdEquality,
];
