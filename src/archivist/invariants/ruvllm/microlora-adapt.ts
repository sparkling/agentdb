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
  loraIdEquality,
];
