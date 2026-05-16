// charter: mutation-invariants
// claims_steal mutation invariants (ADR-0181 §H).
// Steal reassigns an already-stealable claim to a new stealer. The handler
// checks preferredTypes membership; these guards ensure the stealer claimant
// is well-formed before it reaches that check.

import type { Invariant } from '../../registration.js';
import type { ClaimsStealPayload } from '../../handlers/claims/steal.js';
import { claimantWellFormed } from './claim.js';

export type { ClaimsStealPayload };

const ISSUE_ID_MAX = 500;

const issueIdWellFormed: Invariant<ClaimsStealPayload> = ({ recordedPayload }) => {
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
const issueIdEquality: Invariant<ClaimsStealPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.issueId !== recordedPayload.issueId) {
    return {
      violated: true,
      detail: `issueId divergence: intent='${callerIntent.issueId}' recorded='${recordedPayload.issueId}'`,
    };
  }
  return 'pass';
};

const stealerStructural: Invariant<ClaimsStealPayload> = ({ recordedPayload }) => {
  return claimantWellFormed(recordedPayload.stealer, 'stealer');
};

export const stealInvariants: ReadonlyArray<Invariant<ClaimsStealPayload>> = [
  issueIdWellFormed,
  issueIdEquality,
  stealerStructural,
];
