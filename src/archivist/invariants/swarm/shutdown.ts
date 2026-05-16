// charter: mutation-invariants
// swarm_shutdown mutation invariants (ADR-0181 §H).
// Both fields optional. swarmId well-formed when present; graceful boolean.

import type { Invariant } from '../../registration.js';
import type { SwarmShutdownPayload } from '../../handlers/swarm/shutdown.js';

export type { SwarmShutdownPayload };

const SWARM_ID_MAX = 500;

/** swarmId (optional) must be a non-empty string ≤500 chars when present.
 *  Absent => handler shuts down most-recently-updated running swarm. */
const swarmIdWellFormedWhenPresent: Invariant<SwarmShutdownPayload> = ({ recordedPayload }) => {
  const id = recordedPayload.swarmId;
  if (id === undefined || id === null) return 'pass';
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `swarmId must be a non-empty string when present, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > SWARM_ID_MAX) {
    return { violated: true, detail: `swarmId length ${id.length} exceeds max ${SWARM_ID_MAX}` };
  }
  return 'pass';
};

/** swarmId identity — TAUTOLOGY today; ships as contract spec. */
const swarmIdEquality: Invariant<SwarmShutdownPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.swarmId !== recordedPayload.swarmId) {
    return {
      violated: true,
      detail: `swarmId divergence: intent='${callerIntent.swarmId}' recorded='${recordedPayload.swarmId}'`,
    };
  }
  return 'pass';
};

const gracefulBooleanWhenPresent: Invariant<SwarmShutdownPayload> = ({ recordedPayload }) => {
  const g = recordedPayload.graceful;
  if (g === undefined || g === null) return 'pass';
  if (typeof g !== 'boolean') {
    return { violated: true, detail: `graceful must be a boolean when present, got ${typeof g}` };
  }
  return 'pass';
};

export const shutdownInvariants: ReadonlyArray<Invariant<SwarmShutdownPayload>> = [
  swarmIdWellFormedWhenPresent,
  swarmIdEquality,
  gracefulBooleanWhenPresent,
];
