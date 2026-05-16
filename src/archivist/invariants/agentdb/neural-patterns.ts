// charter: mutation-invariants
// agentdb_neural_patterns read-handler invariants (ADR-0181 §H).
// READ handler — RegisterReadOpts doesn't accept invariants today, so these
// ship as the contract spec. TODO(ADR-0180 §Read-path return shape):
// add post-dispatch RankedResults<NeuralPatternHit> well-formedness
// guards when the return-shape invariant design lands.

import type { Invariant } from '../../registration.js';
import type { AgentdbNeuralPatternsQuery } from '../../handlers/agentdb/neural-patterns.js';

export type { AgentdbNeuralPatternsQuery };

const VALID_ACTIONS = new Set(['stats', 'similar']);
const TOP_K_MAX = 1_000;
const EMBED_MAX = 100_000;

const actionInEnumWhenPresent: Invariant<AgentdbNeuralPatternsQuery> = ({ recordedPayload }) => {
  const a = recordedPayload.action;
  if (a === undefined || a === null) return 'pass';
  if (typeof a !== 'string' || !VALID_ACTIONS.has(a)) {
    return { violated: true, detail: `action must be one of {stats,similar}, got ${JSON.stringify(a)}` };
  }
  return 'pass';
};

const topKInRangeWhenPresent: Invariant<AgentdbNeuralPatternsQuery> = ({ recordedPayload }) => {
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

/** embedding (required for similar) must be a non-empty number array
 *  of bounded length when present. */
const embeddingWellFormedWhenPresent: Invariant<AgentdbNeuralPatternsQuery> = ({ recordedPayload }) => {
  const e = recordedPayload.embedding;
  if (e === undefined || e === null) return 'pass';
  if (!Array.isArray(e)) {
    return { violated: true, detail: `embedding must be a number[] when present, got ${typeof e}` };
  }
  if (e.length === 0) {
    return { violated: true, detail: `embedding must be a non-empty number[] when present, got length 0` };
  }
  if (e.length > EMBED_MAX) {
    return { violated: true, detail: `embedding length ${e.length} exceeds max ${EMBED_MAX}` };
  }
  for (const v of e) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { violated: true, detail: `embedding entries must be finite numbers, got ${String(v)}` };
    }
  }
  return 'pass';
};

export const neuralPatternsInvariants: ReadonlyArray<Invariant<AgentdbNeuralPatternsQuery>> = [
  actionInEnumWhenPresent,
  topKInRangeWhenPresent,
  embeddingWellFormedWhenPresent,
];
