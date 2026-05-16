// charter: mutation-invariants
// daa_workflow_execute mutation invariants (ADR-0181 §H).
// Flips workflow.status to 'running'. workflowId must address an existing
// workflow — the handler throws on a miss, but the invariant guards the
// dispatch boundary against malformed input first.

import type { Invariant } from '../../registration.js';
import type { DaaWorkflowExecutePayload } from '../../handlers/daa/workflow-execute.js';

export type { DaaWorkflowExecutePayload };

const ID_MAX = 500;

const workflowIdWellFormed: Invariant<DaaWorkflowExecutePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.workflowId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `workflowId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `workflowId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** workflowId identity — TAUTOLOGY today; ships as contract spec. */
const workflowIdEquality: Invariant<DaaWorkflowExecutePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.workflowId !== recordedPayload.workflowId) {
    return {
      violated: true,
      detail: `workflowId divergence: intent='${callerIntent.workflowId}' recorded='${recordedPayload.workflowId}'`,
    };
  }
  return 'pass';
};

/** agentIds (optional) must be a non-empty string array when present. */
const agentIdsWellFormedWhenPresent: Invariant<DaaWorkflowExecutePayload> = ({ recordedPayload }) => {
  const ids = recordedPayload.agentIds;
  if (ids === undefined || ids === null) return 'pass';
  if (!Array.isArray(ids)) {
    return { violated: true, detail: `agentIds must be an array when present, got ${typeof ids}` };
  }
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) {
      return { violated: true, detail: `agentIds entries must be non-empty strings, got ${JSON.stringify(id)}` };
    }
  }
  return 'pass';
};

/** parallelExecution (optional) must be a boolean when present. */
const parallelExecutionBooleanWhenPresent: Invariant<DaaWorkflowExecutePayload> = ({ recordedPayload }) => {
  const p = recordedPayload.parallelExecution;
  if (p === undefined || p === null) return 'pass';
  if (typeof p !== 'boolean') {
    return { violated: true, detail: `parallelExecution must be a boolean when present, got ${typeof p}` };
  }
  return 'pass';
};

export const workflowExecuteInvariants: ReadonlyArray<Invariant<DaaWorkflowExecutePayload>> = [
  workflowIdWellFormed,
  workflowIdEquality,
  agentIdsWellFormedWhenPresent,
  parallelExecutionBooleanWhenPresent,
];
