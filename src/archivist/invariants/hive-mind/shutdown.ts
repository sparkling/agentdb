// charter: mutation-invariants
// hive-mind_shutdown mutation invariants (ADR-0181 §H).
// Both fields optional. Both booleans when present.

import type { Invariant } from '../../registration.js';
import type { HiveMindShutdownPayload } from '../../handlers/hive-mind/shutdown.js';

export type { HiveMindShutdownPayload };

const gracefulBooleanWhenPresent: Invariant<HiveMindShutdownPayload> = ({ recordedPayload }) => {
  const g = recordedPayload.graceful;
  if (g === undefined || g === null) return 'pass';
  if (typeof g !== 'boolean') {
    return { violated: true, detail: `graceful must be a boolean when present, got ${typeof g}` };
  }
  return 'pass';
};

/** graceful identity — TAUTOLOGY today; ships as contract spec. */
const gracefulEquality: Invariant<HiveMindShutdownPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.graceful !== recordedPayload.graceful) {
    return {
      violated: true,
      detail: `graceful divergence: intent=${String(callerIntent.graceful)} recorded=${String(recordedPayload.graceful)}`,
    };
  }
  return 'pass';
};

const forceBooleanWhenPresent: Invariant<HiveMindShutdownPayload> = ({ recordedPayload }) => {
  const f = recordedPayload.force;
  if (f === undefined || f === null) return 'pass';
  if (typeof f !== 'boolean') {
    return { violated: true, detail: `force must be a boolean when present, got ${typeof f}` };
  }
  return 'pass';
};

export const shutdownInvariants: ReadonlyArray<Invariant<HiveMindShutdownPayload>> = [
  gracefulBooleanWhenPresent,
  gracefulEquality,
  forceBooleanWhenPresent,
];
