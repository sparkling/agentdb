// charter: mutation-invariants
// agentdb_filtered_search read-handler invariants (ADR-0181 §H).
// READ handler — RegisterReadOpts doesn't accept invariants today, so these
// ship as the contract spec. TODO(ADR-0180 §Read-path return shape):
// add post-dispatch RankedResults<FilteredSearchHit> guards on the fusion
// composition (matchType='semantic' today; will upgrade to 'fused' when
// the BM25 leg lands).

import type { Invariant } from '../../registration.js';
import type { AgentdbFilteredSearchQuery } from '../../handlers/agentdb/filtered-search.js';

export type { AgentdbFilteredSearchQuery };

const QUERY_MAX = 10_000;
const NAMESPACE_MAX = 500;
const LIMIT_MAX = 10_000;

const queryWellFormed: Invariant<AgentdbFilteredSearchQuery> = ({ recordedPayload }) => {
  const q = recordedPayload.query;
  if (typeof q !== 'string') {
    return { violated: true, detail: `query must be a string, got ${typeof q}` };
  }
  if (q.length > QUERY_MAX) {
    return { violated: true, detail: `query length ${q.length} exceeds max ${QUERY_MAX}` };
  }
  return 'pass';
};

const namespaceBoundedWhenPresent: Invariant<AgentdbFilteredSearchQuery> = ({ recordedPayload }) => {
  const n = recordedPayload.namespace;
  if (n === undefined || n === null) return 'pass';
  if (typeof n !== 'string') {
    return { violated: true, detail: `namespace must be a string when present, got ${typeof n}` };
  }
  if (n.length > NAMESPACE_MAX) {
    return { violated: true, detail: `namespace length ${n.length} exceeds max ${NAMESPACE_MAX}` };
  }
  return 'pass';
};

const limitInRangeWhenPresent: Invariant<AgentdbFilteredSearchQuery> = ({ recordedPayload }) => {
  const l = recordedPayload.limit;
  if (l === undefined || l === null) return 'pass';
  if (typeof l !== 'number' || !Number.isFinite(l) || !Number.isInteger(l)) {
    return { violated: true, detail: `limit must be a finite integer when present, got ${String(l)}` };
  }
  if (l < 1 || l > LIMIT_MAX) {
    return { violated: true, detail: `limit must be in [1,${LIMIT_MAX}], got ${l}` };
  }
  return 'pass';
};

const thresholdInRangeWhenPresent: Invariant<AgentdbFilteredSearchQuery> = ({ recordedPayload }) => {
  const t = recordedPayload.threshold;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    return { violated: true, detail: `threshold must be a finite number when present, got ${String(t)}` };
  }
  if (t < 0 || t > 1) {
    return { violated: true, detail: `threshold must be in [0,1], got ${t}` };
  }
  return 'pass';
};

const filterObjectWhenPresent: Invariant<AgentdbFilteredSearchQuery> = ({ recordedPayload }) => {
  const f = recordedPayload.filter;
  if (f === undefined || f === null) return 'pass';
  if (typeof f !== 'object' || Array.isArray(f)) {
    return { violated: true, detail: `filter must be a plain object when present, got ${Array.isArray(f) ? 'array' : typeof f}` };
  }
  return 'pass';
};

export const filteredSearchInvariants: ReadonlyArray<Invariant<AgentdbFilteredSearchQuery>> = [
  queryWellFormed,
  namespaceBoundedWhenPresent,
  limitInRangeWhenPresent,
  thresholdInRangeWhenPresent,
  filterObjectWhenPresent,
];
