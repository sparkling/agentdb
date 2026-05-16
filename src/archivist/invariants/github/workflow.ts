// charter: mutation-invariants
// github_workflow mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { GithubWorkflowPayload } from '../../handlers/github/workflow.js';

export type { GithubWorkflowPayload };

const VALID_ACTIONS = new Set(['list', 'status', 'trigger', 'cancel']);
const ID_MAX = 200;

/** action must be one of {list, status, trigger, cancel}. */
const actionInEnum: Invariant<GithubWorkflowPayload> = ({ recordedPayload }) => {
  if (!VALID_ACTIONS.has(recordedPayload.action as string)) {
    return { violated: true, detail: `action must be one of {list,status,trigger,cancel}, got ${JSON.stringify(recordedPayload.action)}` };
  }
  return 'pass';
};

/** action identity — TAUTOLOGY TODAY. */
const actionEquality: Invariant<GithubWorkflowPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.action !== recordedPayload.action) {
    return { violated: true, detail: `action divergence: intent='${callerIntent.action}' recorded='${recordedPayload.action}'` };
  }
  return 'pass';
};

/** workflowId, when present (status optional / trigger/cancel required), must
 *  be a non-empty string ≤200 chars. */
const workflowIdWellFormed: Invariant<GithubWorkflowPayload> = ({ recordedPayload }) => {
  const p = recordedPayload as { workflowId?: unknown };
  if (p.workflowId === undefined) return 'pass';
  if (typeof p.workflowId !== 'string' || p.workflowId.length === 0) {
    return { violated: true, detail: `workflowId must be a non-empty string when present, got ${typeof p.workflowId}` };
  }
  if (p.workflowId.length > ID_MAX) {
    return { violated: true, detail: `workflowId length ${p.workflowId.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

export const workflowInvariants: ReadonlyArray<Invariant<GithubWorkflowPayload>> = [
  actionInEnum,
  actionEquality,
  workflowIdWellFormed,
];
