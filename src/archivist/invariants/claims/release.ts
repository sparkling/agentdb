// charter: mutation-invariants
// claims_release mutation invariants (ADR-0181 §H).
// Release deletes both `claims[issueId]` and `stealable[issueId]`. The
// handler verifies ownership before the delete; these invariants guard the
// dispatch boundary against malformed inputs reaching that ownership check.

import type { Invariant } from '../../registration.js';
import type { ClaimsReleasePayload } from '../../handlers/claims/release.js';
import { claimantWellFormed } from './claim.js';

export type { ClaimsReleasePayload };

const ISSUE_ID_MAX = 500;
const REASON_MAX = 2_000;

const issueIdWellFormed: Invariant<ClaimsReleasePayload> = ({ recordedPayload }) => {
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
const issueIdEquality: Invariant<ClaimsReleasePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.issueId !== recordedPayload.issueId) {
    return {
      violated: true,
      detail: `issueId divergence: intent='${callerIntent.issueId}' recorded='${recordedPayload.issueId}'`,
    };
  }
  return 'pass';
};

const claimantStructural: Invariant<ClaimsReleasePayload> = ({ recordedPayload }) => {
  return claimantWellFormed(recordedPayload.claimant, 'claimant');
};

const reasonBoundedWhenPresent: Invariant<ClaimsReleasePayload> = ({ recordedPayload }) => {
  const r = recordedPayload.reason;
  if (r === undefined || r === null) return 'pass';
  if (typeof r !== 'string') {
    return { violated: true, detail: `reason must be a string when present, got ${typeof r}` };
  }
  if (r.length > REASON_MAX) {
    return { violated: true, detail: `reason length ${r.length} exceeds max ${REASON_MAX}` };
  }
  return 'pass';
};

export const releaseInvariants: ReadonlyArray<Invariant<ClaimsReleasePayload>> = [
  issueIdWellFormed,
  issueIdEquality,
  claimantStructural,
  reasonBoundedWhenPresent,
];
