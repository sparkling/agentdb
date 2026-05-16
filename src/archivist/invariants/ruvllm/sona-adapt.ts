// charter: mutation-invariants
// ruvllm_sona_adapt mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// Quality is the signal SONA adapts to; out-of-range quality would skew the
// online-learning loop.

import type { Invariant } from '../../registration.js';
import type { RuvllmSonaAdaptPayload } from '../../handlers/ruvllm/sona-adapt.js';

export type { RuvllmSonaAdaptPayload };

const ID_MAX = 200;

/** sonaId must be a non-empty string ≤200 chars. */
const sonaIdWellFormed: Invariant<RuvllmSonaAdaptPayload> = ({ recordedPayload }) => {
  const id = recordedPayload.sonaId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `sonaId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `sonaId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** quality must be a finite number in [0, 1]. */
const qualityInRange: Invariant<RuvllmSonaAdaptPayload> = ({ recordedPayload }) => {
  const q = recordedPayload.quality;
  if (typeof q !== 'number' || !Number.isFinite(q)) {
    return { violated: true, detail: `quality must be a finite number, got ${String(q)}` };
  }
  if (q < 0 || q > 1) {
    return { violated: true, detail: `quality must be in [0, 1], got ${q}` };
  }
  return 'pass';
};

/** sonaId identity — TAUTOLOGY TODAY. */
const sonaIdEquality: Invariant<RuvllmSonaAdaptPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.sonaId !== recordedPayload.sonaId) {
    return { violated: true, detail: `sonaId divergence: intent='${callerIntent.sonaId}' recorded='${recordedPayload.sonaId}'` };
  }
  return 'pass';
};

export const sonaAdaptInvariants: ReadonlyArray<Invariant<RuvllmSonaAdaptPayload>> = [
  sonaIdWellFormed,
  qualityInRange,
  sonaIdEquality,
];
