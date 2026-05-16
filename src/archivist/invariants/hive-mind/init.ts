// charter: mutation-invariants
// hive-mind_init mutation invariants (ADR-0181 §H).
// The cli composes the entire HiveStateDoc and hands it in via `payload.state`;
// this handler just lands it under key='root'. The handler already validates
// initialized=true loudly; these invariants add range/well-formedness
// coverage on the doc's required scalar fields.

import type { Invariant } from '../../registration.js';
import type { HiveMindInitPayload } from '../../handlers/hive-mind/init.js';

export type { HiveMindInitPayload };

/** payload.state must be a plain object (handler also checks; redundant guard
 *  at invariant boundary so a non-cli caller can't sneak null/array). */
const stateIsObject: Invariant<HiveMindInitPayload> = ({ recordedPayload }) => {
  const s = recordedPayload.state;
  if (s === null || typeof s !== 'object' || Array.isArray(s)) {
    return { violated: true, detail: `state must be a plain object, got ${Array.isArray(s) ? 'array' : typeof s}` };
  }
  return 'pass';
};

/** state.initialized must be true on init. */
const initializedIsTrue: Invariant<HiveMindInitPayload> = ({ recordedPayload }) => {
  if (recordedPayload.state?.initialized !== true) {
    return { violated: true, detail: `state.initialized must be true on init, got ${String(recordedPayload.state?.initialized)}` };
  }
  return 'pass';
};

/** state.workers must be an array. */
const workersIsArray: Invariant<HiveMindInitPayload> = ({ recordedPayload }) => {
  if (!Array.isArray(recordedPayload.state?.workers)) {
    return { violated: true, detail: `state.workers must be an array, got ${typeof recordedPayload.state?.workers}` };
  }
  return 'pass';
};

/** state.consensus.pending and .history must be arrays. */
const consensusArraysWellFormed: Invariant<HiveMindInitPayload> = ({ recordedPayload }) => {
  const c = recordedPayload.state?.consensus;
  if (!c || typeof c !== 'object') {
    return { violated: true, detail: `state.consensus must be an object, got ${typeof c}` };
  }
  if (!Array.isArray(c.pending)) {
    return { violated: true, detail: `state.consensus.pending must be an array, got ${typeof c.pending}` };
  }
  if (!Array.isArray(c.history)) {
    return { violated: true, detail: `state.consensus.history must be an array, got ${typeof c.history}` };
  }
  return 'pass';
};

/** state.sharedMemory must be a plain object. */
const sharedMemoryIsObject: Invariant<HiveMindInitPayload> = ({ recordedPayload }) => {
  const sm = recordedPayload.state?.sharedMemory;
  if (sm === null || typeof sm !== 'object' || Array.isArray(sm)) {
    return { violated: true, detail: `state.sharedMemory must be a plain object, got ${Array.isArray(sm) ? 'array' : typeof sm}` };
  }
  return 'pass';
};

export const initInvariants: ReadonlyArray<Invariant<HiveMindInitPayload>> = [
  stateIsObject,
  initializedIsTrue,
  workersIsArray,
  consensusArraysWellFormed,
  sharedMemoryIsObject,
];
