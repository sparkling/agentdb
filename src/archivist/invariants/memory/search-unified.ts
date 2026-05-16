// charter: mutation-invariants
// memory_search_unified READ-handler invariants (ADR-0180 §Architecture · Mutation invariants).
//
// TODO(ADR-0181 #104): read handlers don't accept an `invariants:` opt today.

import type { Invariant } from '../../registration.js';
import type { MemorySearchUnifiedQuery } from '../../handlers/memory/search-unified.js';

export type { MemorySearchUnifiedQuery };

const NAMESPACE_MAX = 200;
const QUERY_MAX = 10_000;
const LIMIT_MAX = 1000;

const queryNonEmpty: Invariant<MemorySearchUnifiedQuery> = ({ recordedPayload }) => {
  const q = recordedPayload.query;
  if (typeof q !== 'string' || q.length === 0) {
    return { violated: true, detail: `query must be a non-empty string, got ${typeof q} length=${(q as string)?.length ?? 0}` };
  }
  if (q.length > QUERY_MAX) {
    return { violated: true, detail: `query length ${q.length} exceeds max ${QUERY_MAX}` };
  }
  return 'pass';
};

const namespaceWellFormed: Invariant<MemorySearchUnifiedQuery> = ({ recordedPayload }) => {
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

const limitInRange: Invariant<MemorySearchUnifiedQuery> = ({ recordedPayload }) => {
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

const thresholdInRange: Invariant<MemorySearchUnifiedQuery> = ({ recordedPayload }) => {
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

export const searchUnifiedInvariants: ReadonlyArray<Invariant<MemorySearchUnifiedQuery>> = [
  queryNonEmpty,
  namespaceWellFormed,
  limitInRange,
  thresholdInRange,
];
