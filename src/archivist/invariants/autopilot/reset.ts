// charter: mutation-invariants
// autopilot_reset mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler takes an empty payload; minimal payload-shape check only.

import type { Invariant } from '../../registration.js';
import type { AutopilotResetPayload } from '../../handlers/autopilot/reset.js';

export type { AutopilotResetPayload };

const payloadIsObject: Invariant<AutopilotResetPayload> = ({ recordedPayload }) => {
  if (recordedPayload === null || typeof recordedPayload !== 'object' || Array.isArray(recordedPayload)) {
    return { violated: true, detail: `payload must be an object, got ${typeof recordedPayload}` };
  }
  return 'pass';
};

export const resetInvariants: ReadonlyArray<Invariant<AutopilotResetPayload>> = [
  payloadIsObject,
];
