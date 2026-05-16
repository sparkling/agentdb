// charter: mutation-invariants
// agentdb_hierarchical_recall read-handler invariants (ADR-0181 §H).
// READ handler — RegisterReadOpts doesn't accept invariants today, so these
// ship as the contract spec. TODO(ADR-0180 §Read-path return shape):
// add post-dispatch RankedResults<HierarchicalRecallHit> well-formedness
// guards (importance ordering, tier in enum) when the return-shape
// invariant design lands.

import type { Invariant } from '../../registration.js';
import type { AgentdbHierarchicalRecallQuery } from '../../handlers/agentdb/hierarchical-recall.js';

export type { AgentdbHierarchicalRecallQuery };

const QUERY_MAX = 10_000;
const TOP_K_MAX = 1_000;
const VALID_TIERS = new Set(['working', 'episodic', 'semantic']);

const queryWellFormed: Invariant<AgentdbHierarchicalRecallQuery> = ({ recordedPayload }) => {
  const q = recordedPayload.query;
  if (typeof q !== 'string') {
    return { violated: true, detail: `query must be a string, got ${typeof q}` };
  }
  if (q.length > QUERY_MAX) {
    return { violated: true, detail: `query length ${q.length} exceeds max ${QUERY_MAX}` };
  }
  return 'pass';
};

const tierInEnumWhenPresent: Invariant<AgentdbHierarchicalRecallQuery> = ({ recordedPayload }) => {
  const t = recordedPayload.tier;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'string' || !VALID_TIERS.has(t)) {
    return { violated: true, detail: `tier must be one of {working,episodic,semantic}, got ${JSON.stringify(t)}` };
  }
  return 'pass';
};

const topKInRangeWhenPresent: Invariant<AgentdbHierarchicalRecallQuery> = ({ recordedPayload }) => {
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

export const hierarchicalRecallInvariants: ReadonlyArray<Invariant<AgentdbHierarchicalRecallQuery>> = [
  queryWellFormed,
  tierInEnumWhenPresent,
  topKInRangeWhenPresent,
];
