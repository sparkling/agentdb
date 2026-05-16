// charter: mutation-invariants
// workflow_pause mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { WorkflowPausePayload } from '../../handlers/workflow/pause.js';

export type { WorkflowPausePayload };

const ID_MAX = 200;

const workflowIdWellFormed: Invariant<WorkflowPausePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.workflowId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `workflowId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `workflowId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

const workflowIdEquality: Invariant<WorkflowPausePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.workflowId !== recordedPayload.workflowId) {
    return { violated: true, detail: `workflowId divergence: intent='${callerIntent.workflowId}' recorded='${recordedPayload.workflowId}'` };
  }
  return 'pass';
};

export const pauseInvariants: ReadonlyArray<Invariant<WorkflowPausePayload>> = [
  workflowIdWellFormed,
  workflowIdEquality,
];
