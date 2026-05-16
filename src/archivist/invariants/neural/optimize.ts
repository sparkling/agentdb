// charter: mutation-invariants
// neural_optimize mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler branches on `target` ∈ {speed, memory, accuracy, balanced}.
// Out-of-enum target would skip every optimization branch silently.

import type { Invariant } from '../../registration.js';
import type { NeuralOptimizePayload } from '../../handlers/neural/optimize.js';

export type { NeuralOptimizePayload };

const VALID_TARGETS = new Set(['speed', 'memory', 'accuracy', 'balanced']);

/** target, when present, must be one of {speed, memory, accuracy, balanced}. */
const targetInEnum: Invariant<NeuralOptimizePayload> = ({ recordedPayload }) => {
  const t = recordedPayload.target;
  if (t === undefined) return 'pass';
  if (!VALID_TARGETS.has(t as string)) {
    return { violated: true, detail: `target must be one of {speed,memory,accuracy,balanced}, got ${JSON.stringify(t)}` };
  }
  return 'pass';
};

/** target identity — TAUTOLOGY TODAY. */
const targetEquality: Invariant<NeuralOptimizePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.target !== recordedPayload.target) {
    return { violated: true, detail: `target divergence: intent='${String(callerIntent.target)}' recorded='${String(recordedPayload.target)}'` };
  }
  return 'pass';
};

/** modelId, when present, must be a non-empty string. */
const modelIdWellFormed: Invariant<NeuralOptimizePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.modelId;
  if (id === undefined) return 'pass';
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `modelId must be a non-empty string when present, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  return 'pass';
};

export const optimizeInvariants: ReadonlyArray<Invariant<NeuralOptimizePayload>> = [
  targetInEnum,
  targetEquality,
  modelIdWellFormed,
];
