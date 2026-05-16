// charter: mutation-invariants
// agentdb_skill_search read-handler invariants (ADR-0181 §H).
// READ handler — RegisterReadOpts doesn't accept invariants today, so these
// ship as the contract spec. TODO(ADR-0180 §Read-path return shape):
// add post-dispatch RankedResults<SkillSearchHit> guards (successRate in
// [0,1], similarity monotonic ordering) when the return-shape design lands.

import type { Invariant } from '../../registration.js';
import type { AgentdbSkillSearchQuery } from '../../handlers/agentdb/skill-search.js';

export type { AgentdbSkillSearchQuery };

const QUERY_MAX = 10_000;
const LIMIT_MAX = 1_000;

const queryWellFormed: Invariant<AgentdbSkillSearchQuery> = ({ recordedPayload }) => {
  const q = recordedPayload.query;
  if (typeof q !== 'string' || q.length === 0) {
    return { violated: true, detail: `query must be a non-empty string, got ${typeof q} length=${(q as string)?.length ?? 0}` };
  }
  if (q.length > QUERY_MAX) {
    return { violated: true, detail: `query length ${q.length} exceeds max ${QUERY_MAX}` };
  }
  return 'pass';
};

const limitInRangeWhenPresent: Invariant<AgentdbSkillSearchQuery> = ({ recordedPayload }) => {
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

export const skillSearchInvariants: ReadonlyArray<Invariant<AgentdbSkillSearchQuery>> = [
  queryWellFormed,
  limitInRangeWhenPresent,
];
