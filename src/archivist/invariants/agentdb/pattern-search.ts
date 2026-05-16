// charter: mutation-invariants
// agentdb_pattern_search read-handler invariants (ADR-0181 §H).
// READ handler — RegisterReadOpts doesn't accept invariants today, so these
// ship as the contract spec. TODO(ADR-0180 §Read-path return shape):
// add post-dispatch RankedResults<PatternSearchHit> guards (matchType='fused'
// invariant, monotonic score ordering) when the return-shape design lands.

import type { Invariant } from '../../registration.js';
import type { AgentdbPatternSearchQuery } from '../../handlers/agentdb/pattern-search.js';

export type { AgentdbPatternSearchQuery };

const QUERY_MAX = 10_000;
const TOP_K_MAX = 1_000;

const queryWellFormed: Invariant<AgentdbPatternSearchQuery> = ({ recordedPayload }) => {
  const q = recordedPayload.query;
  if (typeof q !== 'string' || q.length === 0) {
    return { violated: true, detail: `query must be a non-empty string, got ${typeof q} length=${(q as string)?.length ?? 0}` };
  }
  if (q.length > QUERY_MAX) {
    return { violated: true, detail: `query length ${q.length} exceeds max ${QUERY_MAX}` };
  }
  return 'pass';
};

const topKInRangeWhenPresent: Invariant<AgentdbPatternSearchQuery> = ({ recordedPayload }) => {
  const k = recordedPayload.topK;
  if (k === undefined || k === null) return 'pass';
  if (typeof k !== 'number' || !Number.isFinite(k) || !Number.isInteger(k)) {
    return { violated: true, detail: `topK must be a finite integer when present, got ${String(k)}` };
  }
  if (k < 1 || k > TOP_K_MAX) {
    return { violated: true, detail: `topK must be in [1,${TOP_K_MAX}], got ${k}` };
  }
  return 'pass';
};

const minConfidenceInRangeWhenPresent: Invariant<AgentdbPatternSearchQuery> = ({ recordedPayload }) => {
  const mc = recordedPayload.minConfidence;
  if (mc === undefined || mc === null) return 'pass';
  if (typeof mc !== 'number' || !Number.isFinite(mc)) {
    return { violated: true, detail: `minConfidence must be a finite number when present, got ${String(mc)}` };
  }
  if (mc < 0 || mc > 1) {
    return { violated: true, detail: `minConfidence must be in [0,1], got ${mc}` };
  }
  return 'pass';
};

export const patternSearchInvariants: ReadonlyArray<Invariant<AgentdbPatternSearchQuery>> = [
  queryWellFormed,
  topKInRangeWhenPresent,
  minConfidenceInRangeWhenPresent,
];
