// charter: mutation-invariants
// ruvllm_sona_create mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// Bad sonaId or out-of-range hyperparameters would create an instance record
// downstream SONA replay can't honor.

import type { Invariant } from '../../registration.js';
import type { RuvllmSonaCreatePayload } from '../../handlers/ruvllm/sona-create.js';

export type { RuvllmSonaCreatePayload };

const ID_MAX = 200;
const DIM_MAX = 100_000;
const CAPACITY_MAX = 10_000_000;

/** sonaId must be a non-empty string ≤200 chars. */
const sonaIdWellFormed: Invariant<RuvllmSonaCreatePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.sonaId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `sonaId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `sonaId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** sonaId identity — TAUTOLOGY TODAY. */
const sonaIdEquality: Invariant<RuvllmSonaCreatePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.sonaId !== recordedPayload.sonaId) {
    return { violated: true, detail: `sonaId divergence: intent='${callerIntent.sonaId}' recorded='${recordedPayload.sonaId}'` };
  }
  return 'pass';
};

/** config.hiddenDim, when present, must be a finite positive integer. */
const hiddenDimPositiveInteger: Invariant<RuvllmSonaCreatePayload> = ({ recordedPayload }) => {
  const d = recordedPayload.config?.hiddenDim;
  if (d === undefined) return 'pass';
  if (typeof d !== 'number' || !Number.isFinite(d) || !Number.isInteger(d)) {
    return { violated: true, detail: `config.hiddenDim must be a finite integer, got ${String(d)}` };
  }
  if (d < 1 || d > DIM_MAX) {
    return { violated: true, detail: `config.hiddenDim must be in [1, ${DIM_MAX}], got ${d}` };
  }
  return 'pass';
};

/** config.learningRate, when present, must be a finite number in (0, 1]. */
const learningRateInRange: Invariant<RuvllmSonaCreatePayload> = ({ recordedPayload }) => {
  const lr = recordedPayload.config?.learningRate;
  if (lr === undefined) return 'pass';
  if (typeof lr !== 'number' || !Number.isFinite(lr)) {
    return { violated: true, detail: `config.learningRate must be a finite number, got ${String(lr)}` };
  }
  if (lr <= 0 || lr > 1) {
    return { violated: true, detail: `config.learningRate must be in (0, 1], got ${lr}` };
  }
  return 'pass';
};

/** config.patternCapacity, when present, must be a finite positive integer. */
const patternCapacityPositiveInteger: Invariant<RuvllmSonaCreatePayload> = ({ recordedPayload }) => {
  const c = recordedPayload.config?.patternCapacity;
  if (c === undefined) return 'pass';
  if (typeof c !== 'number' || !Number.isFinite(c) || !Number.isInteger(c)) {
    return { violated: true, detail: `config.patternCapacity must be a finite integer, got ${String(c)}` };
  }
  if (c < 1 || c > CAPACITY_MAX) {
    return { violated: true, detail: `config.patternCapacity must be in [1, ${CAPACITY_MAX}], got ${c}` };
  }
  return 'pass';
};

export const sonaCreateInvariants: ReadonlyArray<Invariant<RuvllmSonaCreatePayload>> = [
  sonaIdWellFormed,
  sonaIdEquality,
  hiddenDimPositiveInteger,
  learningRateInRange,
  patternCapacityPositiveInteger,
];
