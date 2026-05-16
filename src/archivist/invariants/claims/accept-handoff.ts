// charter: mutation-invariants
// claims_accept-handoff mutation invariants (ADR-0181 §H).
// Accept flips status back to 'active' and clears the handoff metadata.
// `claimant` must be a well-formed target claimant.

import type { Invariant } from '../../registration.js';
import type { ClaimsAcceptHandoffPayload } from '../../handlers/claims/accept-handoff.js';
import { claimantWellFormed } from './claim.js';

export type { ClaimsAcceptHandoffPayload };

const ISSUE_ID_MAX = 500;

const issueIdWellFormed: Invariant<ClaimsAcceptHandoffPayload> = ({ recordedPayload }) => {
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
const issueIdEquality: Invariant<ClaimsAcceptHandoffPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.issueId !== recordedPayload.issueId) {
    return {
      violated: true,
      detail: `issueId divergence: intent='${callerIntent.issueId}' recorded='${recordedPayload.issueId}'`,
    };
  }
  return 'pass';
};

const claimantStructural: Invariant<ClaimsAcceptHandoffPayload> = ({ recordedPayload }) => {
  return claimantWellFormed(recordedPayload.claimant, 'claimant');
};

export const acceptHandoffInvariants: ReadonlyArray<Invariant<ClaimsAcceptHandoffPayload>> = [
  issueIdWellFormed,
  issueIdEquality,
  claimantStructural,
];
