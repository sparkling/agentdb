// charter: mutation-invariants
// claims_status mutation invariants (ADR-0181 §H).
// Status update flips the ClaimStatus union and (optionally) progress. The
// handler clamps progress; these invariants guard input shape at the
// dispatch boundary.

import type { Invariant } from '../../registration.js';
import type { ClaimsStatusPayload } from '../../handlers/claims/status.js';

export type { ClaimsStatusPayload };

const ISSUE_ID_MAX = 500;
const NOTE_MAX = 10_000;
const VALID_STATUSES = new Set([
  'active',
  'paused',
  'handoff-pending',
  'review-requested',
  'blocked',
  'stealable',
  'completed',
]);

const issueIdWellFormed: Invariant<ClaimsStatusPayload> = ({ recordedPayload }) => {
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
const issueIdEquality: Invariant<ClaimsStatusPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.issueId !== recordedPayload.issueId) {
    return {
      violated: true,
      detail: `issueId divergence: intent='${callerIntent.issueId}' recorded='${recordedPayload.issueId}'`,
    };
  }
  return 'pass';
};

const statusInEnum: Invariant<ClaimsStatusPayload> = ({ recordedPayload }) => {
  const s = recordedPayload.status;
  if (typeof s !== 'string' || !VALID_STATUSES.has(s)) {
    return { violated: true, detail: `status must be a ClaimStatus value, got ${JSON.stringify(s)}` };
  }
  return 'pass';
};

const noteBoundedWhenPresent: Invariant<ClaimsStatusPayload> = ({ recordedPayload }) => {
  const n = recordedPayload.note;
  if (n === undefined || n === null) return 'pass';
  if (typeof n !== 'string') {
    return { violated: true, detail: `note must be a string when present, got ${typeof n}` };
  }
  if (n.length > NOTE_MAX) {
    return { violated: true, detail: `note length ${n.length} exceeds max ${NOTE_MAX}` };
  }
  return 'pass';
};

/** progress must be ∈ [0, 100] when present (the handler clamps too; this
 *  guards the dispatch boundary so a NaN/Infinity surfaces as a violation
 *  rather than silently coerced to 0/100). */
const progressInRangeWhenPresent: Invariant<ClaimsStatusPayload> = ({ recordedPayload }) => {
  const p = recordedPayload.progress;
  if (p === undefined || p === null) return 'pass';
  if (typeof p !== 'number' || !Number.isFinite(p)) {
    return { violated: true, detail: `progress must be a finite number when present, got ${String(p)}` };
  }
  if (p < 0 || p > 100) {
    return { violated: true, detail: `progress must be in [0,100], got ${p}` };
  }
  return 'pass';
};

export const statusInvariants: ReadonlyArray<Invariant<ClaimsStatusPayload>> = [
  issueIdWellFormed,
  issueIdEquality,
  statusInEnum,
  noteBoundedWhenPresent,
  progressInRangeWhenPresent,
];
