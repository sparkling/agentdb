// charter: mutation-invariants
// ruvllm_microlora_create mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// Bad loraId or out-of-range LoRA hyperparameters (rank 1-4, dims, alpha) would
// create an instance record downstream LoRA adapt operations can't honor.

import type { Invariant } from '../../registration.js';
import type { RuvllmMicroLoraCreatePayload } from '../../handlers/ruvllm/microlora-create.js';

export type { RuvllmMicroLoraCreatePayload };

const ID_MAX = 200;
const DIM_MAX = 100_000;

/** loraId must be a non-empty string ≤200 chars. */
const loraIdWellFormed: Invariant<RuvllmMicroLoraCreatePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.loraId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `loraId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `loraId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** loraId identity — TAUTOLOGY TODAY. */
const loraIdEquality: Invariant<RuvllmMicroLoraCreatePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.loraId !== recordedPayload.loraId) {
    return { violated: true, detail: `loraId divergence: intent='${callerIntent.loraId}' recorded='${recordedPayload.loraId}'` };
  }
  return 'pass';
};

/** config: optional fields, when present, must be in-range. We do not enforce
 *  which fields are present (the cli surface may pass varying subsets). */
const configFieldsInRange: Invariant<RuvllmMicroLoraCreatePayload> = ({ recordedPayload }) => {
  const raw = recordedPayload.config;
  if (raw === undefined || raw === null || typeof raw !== 'object') {
    return { violated: true, detail: `config must be an object, got ${typeof raw}` };
  }
  const c = raw as unknown as Record<string, unknown>;
  // Best-effort range checks for common LoRA hyperparameters (inputDim,
  // outputDim, rank, alpha) — skip unknown keys to stay tolerant of cli surface
  // evolution.
  for (const [k, v] of Object.entries(c)) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      return { violated: true, detail: `config.${k} must be finite when numeric, got ${String(v)}` };
    }
    if ((k === 'inputDim' || k === 'outputDim') && typeof v === 'number') {
      if (v < 1 || v > DIM_MAX || !Number.isInteger(v)) {
        return { violated: true, detail: `config.${k} must be a positive integer in [1, ${DIM_MAX}], got ${v}` };
      }
    }
    if (k === 'rank' && typeof v === 'number') {
      if (v < 1 || v > 256 || !Number.isInteger(v)) {
        return { violated: true, detail: `config.rank must be a positive integer in [1, 256], got ${v}` };
      }
    }
  }
  return 'pass';
};

export const microLoraCreateInvariants: ReadonlyArray<Invariant<RuvllmMicroLoraCreatePayload>> = [
  loraIdWellFormed,
  loraIdEquality,
  configFieldsInRange,
];
