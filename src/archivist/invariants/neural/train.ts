// charter: mutation-invariants
// neural_train mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler mints a `NeuralModel`, embeds each training entry, and writes
// patterns under `${modelId}-train-${i}`. Bad modelType / epochs / learningRate
// would corrupt downstream model selection + replay.

import type { Invariant } from '../../registration.js';
import type { NeuralTrainPayload } from '../../handlers/neural/train.js';

export type { NeuralTrainPayload };

const VALID_MODEL_TYPES = new Set(['moe', 'transformer', 'classifier', 'embedding']);
const EPOCHS_MIN = 1;
const EPOCHS_MAX = 10_000;
const LR_MIN = 0;
const LR_MAX = 1; // standard SGD/Adam range — > 1 is almost always misconfigured

/** modelType must be one of {moe, transformer, classifier, embedding}. */
const modelTypeInEnum: Invariant<NeuralTrainPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.modelType;
  if (!VALID_MODEL_TYPES.has(t as string)) {
    return { violated: true, detail: `modelType must be one of {moe,transformer,classifier,embedding}, got ${JSON.stringify(t)}` };
  }
  return 'pass';
};

/** modelType identity — TAUTOLOGY TODAY; ships as contract spec. */
const modelTypeEquality: Invariant<NeuralTrainPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.modelType !== recordedPayload.modelType) {
    return { violated: true, detail: `modelType divergence: intent='${callerIntent.modelType}' recorded='${recordedPayload.modelType}'` };
  }
  return 'pass';
};

/** epochs, when present, must be a finite positive integer in [1, 10_000]. */
const epochsInRange: Invariant<NeuralTrainPayload> = ({ recordedPayload }) => {
  const e = recordedPayload.epochs;
  if (e === undefined) return 'pass';
  if (typeof e !== 'number' || !Number.isFinite(e) || !Number.isInteger(e)) {
    return { violated: true, detail: `epochs must be a finite integer, got ${String(e)}` };
  }
  if (e < EPOCHS_MIN || e > EPOCHS_MAX) {
    return { violated: true, detail: `epochs must be in [${EPOCHS_MIN}, ${EPOCHS_MAX}], got ${e}` };
  }
  return 'pass';
};

/** learningRate, when present, must be a finite number in (0, 1]. */
const learningRateInRange: Invariant<NeuralTrainPayload> = ({ recordedPayload }) => {
  const lr = recordedPayload.learningRate;
  if (lr === undefined) return 'pass';
  if (typeof lr !== 'number' || !Number.isFinite(lr)) {
    return { violated: true, detail: `learningRate must be a finite number, got ${String(lr)}` };
  }
  if (lr <= LR_MIN || lr > LR_MAX) {
    return { violated: true, detail: `learningRate must be in (${LR_MIN}, ${LR_MAX}], got ${lr}` };
  }
  return 'pass';
};

/** modelId, when present, must be a non-empty string. */
const modelIdWellFormed: Invariant<NeuralTrainPayload> = ({ recordedPayload }) => {
  const id = recordedPayload.modelId;
  if (id === undefined) return 'pass';
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `modelId must be a non-empty string when present, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  return 'pass';
};

export const trainInvariants: ReadonlyArray<Invariant<NeuralTrainPayload>> = [
  modelTypeInEnum,
  modelTypeEquality,
  epochsInRange,
  learningRateInRange,
  modelIdWellFormed,
];
