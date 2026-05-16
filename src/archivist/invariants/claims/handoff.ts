// charter: mutation-invariants
// claims_handoff mutation invariants (ADR-0181 §H).
// Handoff flips status to 'handoff-pending' and records the target on
// `handoffTo`. Both `from` and `to` must be well-formed claimants; progress
// must be a sane percentage when present.

import type { Invariant } from '../../registration.js';
import type { ClaimsHandoffPayload } from '../../handlers/claims/handoff.js';
import { claimantWellFormed } from './claim.js';

export type { ClaimsHandoffPayload };

const ISSUE_ID_MAX = 500;
const REASON_MAX = 2_000;

const issueIdWellFormed: Invariant<ClaimsHandoffPayload> = ({ recordedPayload }) => {
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
const issueIdEquality: Invariant<ClaimsHandoffPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.issueId !== recordedPayload.issueId) {
    return {
      violated: true,
      detail: `issueId divergence: intent='${callerIntent.issueId}' recorded='${recordedPayload.issueId}'`,
    };
  }
  return 'pass';
};

const fromClaimantStructural: Invariant<ClaimsHandoffPayload> = ({ recordedPayload }) => {
  return claimantWellFormed(recordedPayload.from, 'from');
};

const toClaimantStructural: Invariant<ClaimsHandoffPayload> = ({ recordedPayload }) => {
  return claimantWellFormed(recordedPayload.to, 'to');
};

const reasonBoundedWhenPresent: Invariant<ClaimsHandoffPayload> = ({ recordedPayload }) => {
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

/** progress (optional) must be ∈ [0, 100] when present. The store renders this
 *  as a percentage; out-of-range values break rebalance load math. */
const progressInRangeWhenPresent: Invariant<ClaimsHandoffPayload> = ({ recordedPayload }) => {
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

export const handoffInvariants: ReadonlyArray<Invariant<ClaimsHandoffPayload>> = [
  issueIdWellFormed,
  issueIdEquality,
  fromClaimantStructural,
  toClaimantStructural,
  reasonBoundedWhenPresent,
  progressInRangeWhenPresent,
];
