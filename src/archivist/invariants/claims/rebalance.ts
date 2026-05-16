// charter: mutation-invariants
// claims_rebalance mutation invariants (ADR-0181 §H).
// Rebalance moves low-progress claims between agents to even load. Both
// `dryRun` and `targetUtilization` are optional knobs; out-of-range
// targetUtilization breaks the threshold math.

import type { Invariant } from '../../registration.js';
import type { ClaimsRebalancePayload } from '../../handlers/claims/rebalance.js';

export type { ClaimsRebalancePayload };

/** dryRun (optional) must be a boolean when present. */
const dryRunBooleanWhenPresent: Invariant<ClaimsRebalancePayload> = ({ recordedPayload }) => {
  const d = recordedPayload.dryRun;
  if (d === undefined || d === null) return 'pass';
  if (typeof d !== 'boolean') {
    return { violated: true, detail: `dryRun must be a boolean when present, got ${typeof d}` };
  }
  return 'pass';
};

/** dryRun identity — TAUTOLOGY today; ships as contract spec. */
const dryRunEquality: Invariant<ClaimsRebalancePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.dryRun !== recordedPayload.dryRun) {
    return {
      violated: true,
      detail: `dryRun divergence: intent=${String(callerIntent.dryRun)} recorded=${String(recordedPayload.dryRun)}`,
    };
  }
  return 'pass';
};

/** targetUtilization must be finite ∈ (0, 1] when present. The handler uses
 *  it as a load fraction; 0/negative collapses the threshold to zero, > 1
 *  inverts the rebalance direction. */
const targetUtilizationInRangeWhenPresent: Invariant<ClaimsRebalancePayload> = ({ recordedPayload }) => {
  const t = recordedPayload.targetUtilization;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    return { violated: true, detail: `targetUtilization must be a finite number when present, got ${String(t)}` };
  }
  if (t <= 0 || t > 1) {
    return { violated: true, detail: `targetUtilization must be in (0,1], got ${t}` };
  }
  return 'pass';
};

export const rebalanceInvariants: ReadonlyArray<Invariant<ClaimsRebalancePayload>> = [
  dryRunBooleanWhenPresent,
  dryRunEquality,
  targetUtilizationInRangeWhenPresent,
];
