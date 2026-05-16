// charter: mutation-invariants
// hive-mind_status read handler invariants (ADR-0181 §H).
// Read handler — invariants here guard the REQUEST payload shape (the only
// thing dispatch can validate today). Return-shape invariants need ADR-0180
// §Read-path return-shape design once that lands.

import type { Invariant } from '../../registration.js';
import type { HiveMindStatusQuery } from '../../handlers/hive-mind/status.js';

export type { HiveMindStatusQuery };

/** verbose (optional) must be a boolean when present. */
const verboseBooleanWhenPresent: Invariant<HiveMindStatusQuery> = ({ recordedPayload }) => {
  const v = recordedPayload?.verbose;
  if (v === undefined || v === null) return 'pass';
  if (typeof v !== 'boolean') {
    return { violated: true, detail: `verbose must be a boolean when present, got ${typeof v}` };
  }
  return 'pass';
};

// TODO(ADR-0180 §Read-path return shape): once a return-shape invariant
// design lands, add post-dispatch guards (e.g. RankedResults<HiveMindStatusEntry>
// well-formedness, monotonic rank ordering, provenance.storeId stability).

export const statusInvariants: ReadonlyArray<Invariant<HiveMindStatusQuery>> = [
  verboseBooleanWhenPresent,
];
