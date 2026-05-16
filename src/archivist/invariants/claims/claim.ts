// charter: mutation-invariants
// claims_claim mutation invariants (ADR-0181 §H).
// First-claim writes a brand-new IssueClaim into the claims store. An empty
// issueId or malformed claimant lands an unaddressable record; both downstream
// claims_* handlers index by `claims[issueId]`.

import type { Invariant } from '../../registration.js';
import type { ClaimsClaimPayload, Claimant } from '../../handlers/claims/claim.js';

export type { ClaimsClaimPayload };

const ISSUE_ID_MAX = 500;
const CONTEXT_MAX = 10_000;

/** issueId must be a non-empty string ≤500 chars. */
const issueIdWellFormed: Invariant<ClaimsClaimPayload> = ({ recordedPayload }) => {
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
const issueIdEquality: Invariant<ClaimsClaimPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.issueId !== recordedPayload.issueId) {
    return {
      violated: true,
      detail: `issueId divergence: intent='${callerIntent.issueId}' recorded='${recordedPayload.issueId}'`,
    };
  }
  return 'pass';
};

/** Claimant must declare a {human|agent} type and carry the matching id field. */
function claimantWellFormed(c: Claimant | undefined, role: string): 'pass' | { violated: true; detail: string } {
  if (!c || typeof c !== 'object') {
    return { violated: true, detail: `${role} must be an object, got ${typeof c}` };
  }
  if (c.type !== 'human' && c.type !== 'agent') {
    return { violated: true, detail: `${role}.type must be 'human' or 'agent', got ${JSON.stringify(c.type)}` };
  }
  if (c.type === 'agent' && (typeof c.agentId !== 'string' || c.agentId.length === 0)) {
    return { violated: true, detail: `${role}.agentId must be a non-empty string when type='agent'` };
  }
  if (c.type === 'human' && (typeof c.userId !== 'string' || c.userId.length === 0)) {
    return { violated: true, detail: `${role}.userId must be a non-empty string when type='human'` };
  }
  return 'pass';
}

const claimantStructuralWellFormed: Invariant<ClaimsClaimPayload> = ({ recordedPayload }) => {
  return claimantWellFormed(recordedPayload.claimant, 'claimant');
};

/** context (optional) must be a string ≤10KB when present. */
const contextBoundedWhenPresent: Invariant<ClaimsClaimPayload> = ({ recordedPayload }) => {
  const ctx = recordedPayload.context;
  if (ctx === undefined || ctx === null) return 'pass';
  if (typeof ctx !== 'string') {
    return { violated: true, detail: `context must be a string when present, got ${typeof ctx}` };
  }
  if (ctx.length > CONTEXT_MAX) {
    return { violated: true, detail: `context length ${ctx.length} exceeds max ${CONTEXT_MAX}` };
  }
  return 'pass';
};

export const claimInvariants: ReadonlyArray<Invariant<ClaimsClaimPayload>> = [
  issueIdWellFormed,
  issueIdEquality,
  claimantStructuralWellFormed,
  contextBoundedWhenPresent,
];

// Re-export claimant helper for sibling invariants (release, handoff, etc.).
export { claimantWellFormed };
