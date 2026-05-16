// charter: mutation-invariants
// claims_mark-stealable mutation invariants (ADR-0181 §H).
// Mark-stealable writes a StealableInfo record beside the claim. The reason
// must be one of the enum variants; preferredTypes must be a string array.

import type { Invariant } from '../../registration.js';
import type { ClaimsMarkStealablePayload } from '../../handlers/claims/mark-stealable.js';

export type { ClaimsMarkStealablePayload };

const ISSUE_ID_MAX = 500;
const CONTEXT_MAX = 10_000;
const VALID_REASONS = new Set(['overloaded', 'stale', 'blocked-timeout', 'voluntary']);

const issueIdWellFormed: Invariant<ClaimsMarkStealablePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.issueId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `issueId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ISSUE_ID_MAX) {
    return { violated: true, detail: `issueId length ${id.length} exceeds max ${ISSUE_ID_MAX}` };
  }
  return 'pass';
};

/** issueId identity — TAUTOLOGY today; ships as contract spec. */
const issueIdEquality: Invariant<ClaimsMarkStealablePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.issueId !== recordedPayload.issueId) {
    return {
      violated: true,
      detail: `issueId divergence: intent='${callerIntent.issueId}' recorded='${recordedPayload.issueId}'`,
    };
  }
  return 'pass';
};

const reasonInEnum: Invariant<ClaimsMarkStealablePayload> = ({ recordedPayload }) => {
  const r = recordedPayload.reason;
  if (typeof r !== 'string' || !VALID_REASONS.has(r)) {
    return { violated: true, detail: `reason must be a StealReason, got ${JSON.stringify(r)}` };
  }
  return 'pass';
};

/** preferredTypes must be an array of non-empty strings when present.
 *  claims_steal honours this list and rejects stealers outside it; a
 *  malformed list either silently widens or blocks every steal. */
const preferredTypesWellFormedWhenPresent: Invariant<ClaimsMarkStealablePayload> = ({ recordedPayload }) => {
  const pt = recordedPayload.preferredTypes;
  if (pt === undefined || pt === null) return 'pass';
  if (!Array.isArray(pt)) {
    return { violated: true, detail: `preferredTypes must be an array when present, got ${typeof pt}` };
  }
  for (const t of pt) {
    if (typeof t !== 'string' || t.length === 0) {
      return { violated: true, detail: `preferredTypes entries must be non-empty strings, got ${JSON.stringify(t)}` };
    }
  }
  return 'pass';
};

const contextBoundedWhenPresent: Invariant<ClaimsMarkStealablePayload> = ({ recordedPayload }) => {
  const c = recordedPayload.context;
  if (c === undefined || c === null) return 'pass';
  if (typeof c !== 'string') {
    return { violated: true, detail: `context must be a string when present, got ${typeof c}` };
  }
  if (c.length > CONTEXT_MAX) {
    return { violated: true, detail: `context length ${c.length} exceeds max ${CONTEXT_MAX}` };
  }
  return 'pass';
};

export const markStealableInvariants: ReadonlyArray<Invariant<ClaimsMarkStealablePayload>> = [
  issueIdWellFormed,
  issueIdEquality,
  reasonInEnum,
  preferredTypesWellFormedWhenPresent,
  contextBoundedWhenPresent,
];
