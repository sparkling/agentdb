// charter: mutation-invariants
// memory_list READ-handler invariants (ADR-0180 §Architecture · Mutation invariants).
//
// TODO(ADR-0181 #104): read handlers don't currently accept an `invariants:`
// opt in registerReadHandler — the registry only carries them on mutation
// entries today. These invariants ship as the contract spec; they will wire
// once `RegisterReadOpts.invariants` lands.

import type { Invariant } from '../../registration.js';
import type { MemoryListQuery } from '../../handlers/memory/list.js';

export type { MemoryListQuery };

const NAMESPACE_MAX = 200;
const LIMIT_MAX = 10_000;

/** namespace, when present, must be a non-empty string ≤200 chars. */
const namespaceWellFormed: Invariant<MemoryListQuery> = ({ recordedPayload }) => {
  const n = recordedPayload.namespace;
  if (n === undefined) return 'pass';
  if (typeof n !== 'string' || n.length === 0) {
    return { violated: true, detail: `namespace must be a non-empty string when present, got ${typeof n}` };
  }
  if (n.length > NAMESPACE_MAX) {
    return { violated: true, detail: `namespace length ${n.length} exceeds max ${NAMESPACE_MAX}` };
  }
  return 'pass';
};

/** limit, when present, must be a finite positive integer ≤10000. */
const limitInRange: Invariant<MemoryListQuery> = ({ recordedPayload }) => {
  const l = recordedPayload.limit;
  if (l === undefined) return 'pass';
  if (typeof l !== 'number' || !Number.isFinite(l) || !Number.isInteger(l)) {
    return { violated: true, detail: `limit must be a finite integer, got ${String(l)}` };
  }
  if (l < 1 || l > LIMIT_MAX) {
    return { violated: true, detail: `limit must be in [1, ${LIMIT_MAX}], got ${l}` };
  }
  return 'pass';
};

/** offset, when present, must be a finite non-negative integer. */
const offsetNonNegative: Invariant<MemoryListQuery> = ({ recordedPayload }) => {
  const o = recordedPayload.offset;
  if (o === undefined) return 'pass';
  if (typeof o !== 'number' || !Number.isFinite(o) || !Number.isInteger(o)) {
    return { violated: true, detail: `offset must be a finite integer, got ${String(o)}` };
  }
  if (o < 0) {
    return { violated: true, detail: `offset must be >= 0, got ${o}` };
  }
  return 'pass';
};

export const listInvariants: ReadonlyArray<Invariant<MemoryListQuery>> = [
  namespaceWellFormed,
  limitInRange,
  offsetNonNegative,
];
