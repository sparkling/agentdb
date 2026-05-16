// charter: mutation-invariants
// workflow_cancel mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { WorkflowCancelPayload } from '../../handlers/workflow/cancel.js';

export type { WorkflowCancelPayload };

const ID_MAX = 200;
const REASON_MAX = 1000;

/** workflowId must be a non-empty string ≤200 chars. */
const workflowIdWellFormed: Invariant<WorkflowCancelPayload> = ({ recordedPayload }) => {
  const id = recordedPayload.workflowId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `workflowId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `workflowId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** reason, when present, must be a string ≤1000 chars. */
const reasonBounded: Invariant<WorkflowCancelPayload> = ({ recordedPayload }) => {
  const r = recordedPayload.reason;
  if (r === undefined) return 'pass';
  if (typeof r !== 'string') {
    return { violated: true, detail: `reason must be a string when present, got ${typeof r}` };
  }
  if (r.length > REASON_MAX) {
    return { violated: true, detail: `reason length ${r.length} exceeds max ${REASON_MAX}` };
  }
  return 'pass';
};

/** workflowId identity — TAUTOLOGY TODAY. */
const workflowIdEquality: Invariant<WorkflowCancelPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.workflowId !== recordedPayload.workflowId) {
    return { violated: true, detail: `workflowId divergence: intent='${callerIntent.workflowId}' recorded='${recordedPayload.workflowId}'` };
  }
  return 'pass';
};

export const cancelInvariants: ReadonlyArray<Invariant<WorkflowCancelPayload>> = [
  workflowIdWellFormed,
  reasonBounded,
  workflowIdEquality,
];
