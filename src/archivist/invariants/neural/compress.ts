// charter: mutation-invariants
// neural_compress mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler branches on `method` ∈ {quantize, prune, distill} against the
// neural-pattern store. Out-of-enum method or non-finite targetSize would skip
// the intended pruning branch or produce a degenerate threshold.

import type { Invariant } from '../../registration.js';
import type { NeuralCompressPayload } from '../../handlers/neural/compress.js';

export type { NeuralCompressPayload };

const VALID_METHODS = new Set(['quantize', 'prune', 'distill']);

/** method, when present, must be one of {quantize, prune, distill}. */
const methodInEnum: Invariant<NeuralCompressPayload> = ({ recordedPayload }) => {
  const m = recordedPayload.method;
  if (m === undefined) return 'pass';
  if (!VALID_METHODS.has(m as string)) {
    return { violated: true, detail: `method must be one of {quantize,prune,distill}, got ${JSON.stringify(m)}` };
  }
  return 'pass';
};

/** method identity — TAUTOLOGY TODAY. */
const methodEquality: Invariant<NeuralCompressPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.method !== recordedPayload.method) {
    return { violated: true, detail: `method divergence: intent='${String(callerIntent.method)}' recorded='${String(recordedPayload.method)}'` };
  }
  return 'pass';
};

/** targetSize, when present, must be a finite non-negative number. The prune
 *  branch reads this as a usageCount threshold; non-finite / NaN would either
 *  drop every pattern or none. */
const targetSizeNonNegative: Invariant<NeuralCompressPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.targetSize;
  if (t === undefined) return 'pass';
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    return { violated: true, detail: `targetSize must be a finite number, got ${String(t)}` };
  }
  if (t < 0) {
    return { violated: true, detail: `targetSize must be >= 0, got ${t}` };
  }
  return 'pass';
};

/** modelId, when present, must be a non-empty string. */
const modelIdWellFormed: Invariant<NeuralCompressPayload> = ({ recordedPayload }) => {
  const id = recordedPayload.modelId;
  if (id === undefined) return 'pass';
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `modelId must be a non-empty string when present, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  return 'pass';
};

export const compressInvariants: ReadonlyArray<Invariant<NeuralCompressPayload>> = [
  methodInEnum,
  methodEquality,
  targetSizeNonNegative,
  modelIdWellFormed,
];
