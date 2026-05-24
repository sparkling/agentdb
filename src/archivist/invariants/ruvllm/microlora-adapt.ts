// charter: mutation-invariants
// ruvllm_microlora_adapt mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// Quality + optional learningRate / success drive the LoRA adapt journal entry.

import type { Invariant } from '../../registration.js';
import type { RuvllmMicroLoraAdaptPayload } from '../../handlers/ruvllm/microlora-adapt.js';

export type { RuvllmMicroLoraAdaptPayload };

const ID_MAX = 200;

/** loraId must be a non-empty string ≤200 chars. */
const loraIdWellFormed: Invariant<RuvllmMicroLoraAdaptPayload> = ({ recordedPayload }) => {
  const id = recordedPayload.loraId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `loraId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `loraId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** quality must be a finite number in [0, 1]. */
const qualityInRange: Invariant<RuvllmMicroLoraAdaptPayload> = ({ recordedPayload }) => {
  const q = recordedPayload.quality;
  if (typeof q !== 'number' || !Number.isFinite(q)) {
    return { violated: true, detail: `quality must be a finite number, got ${String(q)}` };
  }
  if (q < 0 || q > 1) {
    return { violated: true, detail: `quality must be in [0, 1], got ${q}` };
  }
  return 'pass';
};

/** learningRate, when present, must be a finite number in (0, 1]. */
const learningRateInRange: Invariant<RuvllmMicroLoraAdaptPayload> = ({ recordedPayload }) => {
  const lr = recordedPayload.learningRate;
  if (lr === undefined) return 'pass';
  if (typeof lr !== 'number' || !Number.isFinite(lr)) {
    return { violated: true, detail: `learningRate must be a finite number, got ${String(lr)}` };
  }
  if (lr <= 0 || lr > 1) {
    return { violated: true, detail: `learningRate must be in (0, 1], got ${lr}` };
  }
  return 'pass';
};

/** success, when present, must be a boolean. */
const successBoolean: Invariant<RuvllmMicroLoraAdaptPayload> = ({ recordedPayload }) => {
  if (recordedPayload.success === undefined) return 'pass';
  if (typeof recordedPayload.success !== 'boolean') {
    return { violated: true, detail: `success must be a boolean when present, got ${typeof recordedPayload.success}` };
  }
  return 'pass';
};

/**
 * ADR-0231 Wave 2: `input` must be a non-empty array of finite numbers.
 * The length-vs-inputDim check lives in the handler (it needs the store —
 * invariants only see the payload).
 */
const inputWellFormed: Invariant<RuvllmMicroLoraAdaptPayload> = ({ recordedPayload }) => {
  const input = recordedPayload.input;
  if (!Array.isArray(input) && !ArrayBuffer.isView(input as unknown as ArrayBufferView)) {
    return { violated: true, detail: `input must be an array of numbers, got ${typeof input}` };
  }
  if ((input as ReadonlyArray<number>).length === 0) {
    return { violated: true, detail: 'input must be a non-empty vector' };
  }
  for (let i = 0; i < (input as ReadonlyArray<number>).length; i++) {
    const v = (input as ReadonlyArray<number>)[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { violated: true, detail: `input[${i}] must be a finite number, got ${String(v)}` };
    }
  }
  return 'pass';
};

/**
 * ADR-0231 Wave 2 (Q-3 root-cause guard): `input` must contain at least one
 * non-zero element. Per feedback-no-fallbacks, an all-zero input vector is
 * the pre-fork no-op bug and is rejected here — silent fallthrough on a
 * zero-gradient adapt would mask the very failure ADR-0231 fixes.
 */
const inputIsNotAllZero: Invariant<RuvllmMicroLoraAdaptPayload> = ({ recordedPayload }) => {
  const input = recordedPayload.input;
  if (!Array.isArray(input) && !ArrayBuffer.isView(input as unknown as ArrayBufferView)) {
    // Shape-error: let inputWellFormed report it; this invariant guards numerics only.
    return 'pass';
  }
  const arr = input as ReadonlyArray<number>;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== 0) return 'pass';
  }
  return {
    violated: true,
    detail:
      'input vector is all-zero; per ADR-0231 this is the pre-fork no-op bug ' +
      '(zero gradient ⇒ no weight change) and is rejected per feedback-no-fallbacks',
  };
};

/** consolidate, when present, must be a boolean. */
const consolidateBoolean: Invariant<RuvllmMicroLoraAdaptPayload> = ({ recordedPayload }) => {
  if (recordedPayload.consolidate === undefined) return 'pass';
  if (typeof recordedPayload.consolidate !== 'boolean') {
    return { violated: true, detail: `consolidate must be a boolean when present, got ${typeof recordedPayload.consolidate}` };
  }
  return 'pass';
};

/** loraId identity — TAUTOLOGY TODAY. */
const loraIdEquality: Invariant<RuvllmMicroLoraAdaptPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.loraId !== recordedPayload.loraId) {
    return { violated: true, detail: `loraId divergence: intent='${callerIntent.loraId}' recorded='${recordedPayload.loraId}'` };
  }
  return 'pass';
};

export const microLoraAdaptInvariants: ReadonlyArray<Invariant<RuvllmMicroLoraAdaptPayload>> = [
  loraIdWellFormed,
  qualityInRange,
  learningRateInRange,
  successBoolean,
  inputWellFormed,
  inputIsNotAllZero,
  consolidateBoolean,
  loraIdEquality,
];
