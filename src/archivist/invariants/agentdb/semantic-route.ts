// charter: mutation-invariants
// agentdb_semantic_route read-handler invariants (ADR-0181 §H).
// READ handler — RegisterReadOpts doesn't accept invariants today, so these
// ship as the contract spec. TODO(ADR-0180 §Read-path return shape):
// add post-dispatch RankedResults<SemanticRouteHit> guards (confidence in
// [0,1], rank monotonic) when the return-shape design lands.

import type { Invariant } from '../../registration.js';
import type { AgentdbSemanticRouteQuery } from '../../handlers/agentdb/semantic-route.js';

export type { AgentdbSemanticRouteQuery };

const INPUT_MAX = 10_000;
const TOP_K_MAX = 1_000;

const inputWellFormed: Invariant<AgentdbSemanticRouteQuery> = ({ recordedPayload }) => {
  const i = recordedPayload.input;
  if (typeof i !== 'string' || i.length === 0) {
    return { violated: true, detail: `input must be a non-empty string, got ${typeof i} length=${(i as string)?.length ?? 0}` };
  }
  if (i.length > INPUT_MAX) {
    return { violated: true, detail: `input length ${i.length} exceeds max ${INPUT_MAX}` };
  }
  return 'pass';
};

const topKInRangeWhenPresent: Invariant<AgentdbSemanticRouteQuery> = ({ recordedPayload }) => {
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

export const semanticRouteInvariants: ReadonlyArray<Invariant<AgentdbSemanticRouteQuery>> = [
  inputWellFormed,
  topKInRangeWhenPresent,
];
