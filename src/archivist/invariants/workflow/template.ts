// charter: mutation-invariants
// workflow_template mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler discriminates on `action` ∈ {save, create, list}. Bad action or
// required id/name fields missing for the discriminant would skip the intended
// branch.

import type { Invariant } from '../../registration.js';
import type { WorkflowTemplatePayload } from '../../handlers/workflow/template.js';

export type { WorkflowTemplatePayload };

const VALID_ACTIONS = new Set(['save', 'create', 'list']);
const ID_MAX = 200;
const NAME_MAX = 500;

/** action must be one of {save, create, list}. */
const actionInEnum: Invariant<WorkflowTemplatePayload> = ({ recordedPayload }) => {
  if (!VALID_ACTIONS.has(recordedPayload.action as string)) {
    return { violated: true, detail: `action must be one of {save,create,list}, got ${JSON.stringify(recordedPayload.action)}` };
  }
  return 'pass';
};

/** action identity — TAUTOLOGY TODAY. */
const actionEquality: Invariant<WorkflowTemplatePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.action !== recordedPayload.action) {
    return { violated: true, detail: `action divergence: intent='${callerIntent.action}' recorded='${recordedPayload.action}'` };
  }
  return 'pass';
};

/** save action: workflowId, when present, must be a non-empty string. */
const workflowIdWellFormed: Invariant<WorkflowTemplatePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.workflowId;
  if (id === undefined) return 'pass';
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `workflowId must be a non-empty string when present, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `workflowId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** create action: templateId, when present, must be a non-empty string. */
const templateIdWellFormed: Invariant<WorkflowTemplatePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.templateId;
  if (id === undefined) return 'pass';
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `templateId must be a non-empty string when present, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `templateId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** templateName / newName, when present, must be non-empty strings ≤500 chars. */
const nameLengthsBounded: Invariant<WorkflowTemplatePayload> = ({ recordedPayload }) => {
  if (recordedPayload.templateName !== undefined) {
    const n = recordedPayload.templateName;
    if (typeof n !== 'string' || n.length === 0) {
      return { violated: true, detail: `templateName must be a non-empty string when present, got ${typeof n}` };
    }
    if (n.length > NAME_MAX) {
      return { violated: true, detail: `templateName length ${n.length} exceeds max ${NAME_MAX}` };
    }
  }
  if (recordedPayload.newName !== undefined) {
    const n = recordedPayload.newName;
    if (typeof n !== 'string' || n.length === 0) {
      return { violated: true, detail: `newName must be a non-empty string when present, got ${typeof n}` };
    }
    if (n.length > NAME_MAX) {
      return { violated: true, detail: `newName length ${n.length} exceeds max ${NAME_MAX}` };
    }
  }
  return 'pass';
};

export const templateInvariants: ReadonlyArray<Invariant<WorkflowTemplatePayload>> = [
  actionInEnum,
  actionEquality,
  workflowIdWellFormed,
  templateIdWellFormed,
  nameLengthsBounded,
];
