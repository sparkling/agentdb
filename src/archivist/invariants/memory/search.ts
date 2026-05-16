// charter: mutation-invariants
// memory_search READ-handler invariants (ADR-0180 §Architecture · Mutation invariants).
//
// TODO(ADR-0181 #104): read handlers don't accept an `invariants:` opt today.
// Ships as contract spec.

import type { Invariant } from '../../registration.js';
import type { MemorySearchQuery } from '../../handlers/memory/search.js';

export type { MemorySearchQuery };

const NAMESPACE_MAX = 200;
const TEXT_MAX = 10_000;
const LIMIT_MAX = 1000;

/** text must be a non-empty string ≤10KB (the query). */
const textNonEmpty: Invariant<MemorySearchQuery> = ({ recordedPayload }) => {
  const t = recordedPayload.text;
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `text must be a non-empty string, got ${typeof t} length=${(t as string)?.length ?? 0}` };
  }
  if (t.length > TEXT_MAX) {
    return { violated: true, detail: `text length ${t.length} exceeds max ${TEXT_MAX}` };
  }
  return 'pass';
};

/** namespace, when present, must be a non-empty string. */
const namespaceWellFormed: Invariant<MemorySearchQuery> = ({ recordedPayload }) => {
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

/** limit, when present, must be a finite positive integer ≤1000. */
const limitInRange: Invariant<MemorySearchQuery> = ({ recordedPayload }) => {
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

/** threshold, when present, must be a finite number in [0, 1]. */
const thresholdInRange: Invariant<MemorySearchQuery> = ({ recordedPayload }) => {
  const t = recordedPayload.threshold;
  if (t === undefined) return 'pass';
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    return { violated: true, detail: `threshold must be a finite number, got ${String(t)}` };
  }
  if (t < 0 || t > 1) {
    return { violated: true, detail: `threshold must be in [0, 1], got ${t}` };
  }
  return 'pass';
};

export const searchInvariants: ReadonlyArray<Invariant<MemorySearchQuery>> = [
  textNonEmpty,
  namespaceWellFormed,
  limitInRange,
  thresholdInRange,
];
