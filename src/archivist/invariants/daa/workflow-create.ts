// charter: mutation-invariants
// daa_workflow_create mutation invariants (ADR-0181 §H).
// Workflows live keyed by id; downstream workflow-execute looks up by id.

import type { Invariant } from '../../registration.js';
import type { DaaWorkflowCreatePayload } from '../../handlers/daa/workflow-create.js';

export type { DaaWorkflowCreatePayload };

const ID_MAX = 500;
const NAME_MAX = 500;
const VALID_STRATEGIES = new Set(['parallel', 'sequential', 'adaptive']);

const idWellFormed: Invariant<DaaWorkflowCreatePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.id;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `id must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `id length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** id identity — TAUTOLOGY today; ships as contract spec. */
const idEquality: Invariant<DaaWorkflowCreatePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.id !== recordedPayload.id) {
    return {
      violated: true,
      detail: `id divergence: intent='${callerIntent.id}' recorded='${recordedPayload.id}'`,
    };
  }
  return 'pass';
};

/** name must be a non-empty string ≤500 chars. */
const nameWellFormed: Invariant<DaaWorkflowCreatePayload> = ({ recordedPayload }) => {
  const n = recordedPayload.name;
  if (typeof n !== 'string' || n.length === 0) {
    return { violated: true, detail: `name must be a non-empty string, got ${typeof n} length=${(n as string)?.length ?? 0}` };
  }
  if (n.length > NAME_MAX) {
    return { violated: true, detail: `name length ${n.length} exceeds max ${NAME_MAX}` };
  }
  return 'pass';
};

/** strategy (optional) must be one of {parallel, sequential, adaptive}. */
const strategyInEnumWhenPresent: Invariant<DaaWorkflowCreatePayload> = ({ recordedPayload }) => {
  const s = recordedPayload.strategy;
  if (s === undefined || s === null) return 'pass';
  if (typeof s !== 'string' || !VALID_STRATEGIES.has(s)) {
    return { violated: true, detail: `strategy must be one of {parallel,sequential,adaptive}, got ${JSON.stringify(s)}` };
  }
  return 'pass';
};

/** steps (optional) must be an array when present. Per-step shape is
 *  heterogeneous (string or object) — the handler canonicalises both forms
 *  so we only guard the outer container here. */
const stepsArrayWhenPresent: Invariant<DaaWorkflowCreatePayload> = ({ recordedPayload }) => {
  const s = recordedPayload.steps;
  if (s === undefined || s === null) return 'pass';
  if (!Array.isArray(s)) {
    return { violated: true, detail: `steps must be an array when present, got ${typeof s}` };
  }
  return 'pass';
};

export const workflowCreateInvariants: ReadonlyArray<Invariant<DaaWorkflowCreatePayload>> = [
  idWellFormed,
  idEquality,
  nameWellFormed,
  strategyInEnumWhenPresent,
  stepsArrayWhenPresent,
];
