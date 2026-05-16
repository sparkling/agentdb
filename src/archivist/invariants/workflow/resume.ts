// charter: mutation-invariants
// workflow_resume mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { WorkflowResumePayload } from '../../handlers/workflow/resume.js';

export type { WorkflowResumePayload };

const ID_MAX = 200;

const workflowIdWellFormed: Invariant<WorkflowResumePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.workflowId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `workflowId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `workflowId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

const workflowIdEquality: Invariant<WorkflowResumePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.workflowId !== recordedPayload.workflowId) {
    return { violated: true, detail: `workflowId divergence: intent='${callerIntent.workflowId}' recorded='${recordedPayload.workflowId}'` };
  }
  return 'pass';
};

export const resumeInvariants: ReadonlyArray<Invariant<WorkflowResumePayload>> = [
  workflowIdWellFormed,
  workflowIdEquality,
];
