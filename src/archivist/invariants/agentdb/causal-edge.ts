// charter: mutation-invariants
// agentdb_causal_edge mutation invariants (ADR-0181 §H).
// CausalMemoryGraph edge writer. Empty source/target/relation collapses
// the per-edge identity; out-of-range weight breaks ADR-0033 uplift math.

import type { Invariant } from '../../registration.js';
import type { AgentdbCausalEdgePayload } from '../../handlers/agentdb/causal-edge.js';

export type { AgentdbCausalEdgePayload };

const ID_MAX = 500;
const RELATION_MAX = 200;

/** sourceId must be a non-empty string ≤500 chars. */
const sourceIdWellFormed: Invariant<AgentdbCausalEdgePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.sourceId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `sourceId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `sourceId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** sourceId identity — TAUTOLOGY today; ships as contract spec. */
const sourceIdEquality: Invariant<AgentdbCausalEdgePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.sourceId !== recordedPayload.sourceId) {
    return {
      violated: true,
      detail: `sourceId divergence: intent='${callerIntent.sourceId}' recorded='${recordedPayload.sourceId}'`,
    };
  }
  return 'pass';
};

/** targetId must be a non-empty string ≤500 chars. */
const targetIdWellFormed: Invariant<AgentdbCausalEdgePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.targetId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `targetId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `targetId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** targetId identity — TAUTOLOGY today; ships as contract spec. */
const targetIdEquality: Invariant<AgentdbCausalEdgePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.targetId !== recordedPayload.targetId) {
    return {
      violated: true,
      detail: `targetId divergence: intent='${callerIntent.targetId}' recorded='${recordedPayload.targetId}'`,
    };
  }
  return 'pass';
};

/** relation must be a non-empty string ≤200 chars. */
const relationWellFormed: Invariant<AgentdbCausalEdgePayload> = ({ recordedPayload }) => {
  const r = recordedPayload.relation;
  if (typeof r !== 'string' || r.length === 0) {
    return { violated: true, detail: `relation must be a non-empty string, got ${typeof r} length=${(r as string)?.length ?? 0}` };
  }
  if (r.length > RELATION_MAX) {
    return { violated: true, detail: `relation length ${r.length} exceeds max ${RELATION_MAX}` };
  }
  return 'pass';
};

/** weight (optional) must be finite ∈ [0, 1] when present (cli validateScore default 0.5). */
const weightInRangeWhenPresent: Invariant<AgentdbCausalEdgePayload> = ({ recordedPayload }) => {
  const w = recordedPayload.weight;
  if (w === undefined || w === null) return 'pass';
  if (typeof w !== 'number' || !Number.isFinite(w)) {
    return { violated: true, detail: `weight must be a finite number when present, got ${String(w)}` };
  }
  if (w < 0 || w > 1) {
    return { violated: true, detail: `weight must be in [0,1], got ${w}` };
  }
  return 'pass';
};

export const causalEdgeInvariants: ReadonlyArray<Invariant<AgentdbCausalEdgePayload>> = [
  sourceIdWellFormed,
  sourceIdEquality,
  targetIdWellFormed,
  targetIdEquality,
  relationWellFormed,
  weightInRangeWhenPresent,
];
