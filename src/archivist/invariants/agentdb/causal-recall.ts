// charter: mutation-invariants
// agentdb_causal_recall read-handler invariants (ADR-0181 §H).
// READ handler — RegisterReadOpts doesn't accept invariants today, so these
// ship as the contract spec. They cover REQUEST-payload range/well-formedness.
// TODO(ADR-0180 §Read-path return shape): once a return-shape invariant
// design lands, add post-dispatch RankedResults<CausalRecallHit> guards.

import type { Invariant } from '../../registration.js';
import type { AgentdbCausalRecallQuery } from '../../handlers/agentdb/causal-recall.js';

export type { AgentdbCausalRecallQuery };

const QUERY_MAX = 10_000;
const K_MAX = 1_000;

const queryWellFormed: Invariant<AgentdbCausalRecallQuery> = ({ recordedPayload }) => {
  const q = recordedPayload.query;
  if (typeof q !== 'string') {
    return { violated: true, detail: `query must be a string, got ${typeof q}` };
  }
  if (q.length > QUERY_MAX) {
    return { violated: true, detail: `query length ${q.length} exceeds max ${QUERY_MAX}` };
  }
  return 'pass';
};

const kInRangeWhenPresent: Invariant<AgentdbCausalRecallQuery> = ({ recordedPayload }) => {
  const k = recordedPayload.k;
  if (k === undefined || k === null) return 'pass';
  if (typeof k !== 'number' || !Number.isFinite(k) || !Number.isInteger(k)) {
    return { violated: true, detail: `k must be a finite integer when present, got ${String(k)}` };
  }
  if (k < 1 || k > K_MAX) {
    return { violated: true, detail: `k must be in [1,${K_MAX}], got ${k}` };
  }
  return 'pass';
};

const includeEvidenceBooleanWhenPresent: Invariant<AgentdbCausalRecallQuery> = ({ recordedPayload }) => {
  const ie = recordedPayload.includeEvidence;
  if (ie === undefined || ie === null) return 'pass';
  if (typeof ie !== 'boolean') {
    return { violated: true, detail: `includeEvidence must be a boolean when present, got ${typeof ie}` };
  }
  return 'pass';
};

const minConfidenceInRangeWhenPresent: Invariant<AgentdbCausalRecallQuery> = ({ recordedPayload }) => {
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

export const causalRecallInvariants: ReadonlyArray<Invariant<AgentdbCausalRecallQuery>> = [
  queryWellFormed,
  kInRangeWhenPresent,
  includeEvidenceBooleanWhenPresent,
  minConfidenceInRangeWhenPresent,
];
