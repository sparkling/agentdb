// charter: mutation-invariants
// autopilot_disable mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler takes an empty payload; the invariant array is intentionally minimal
// — payload shape is `Record<string, never>`, so the only meaningful check is
// payload-shape (must be an object, not e.g. a string / number).

import type { Invariant } from '../../registration.js';
import type { AutopilotDisablePayload } from '../../handlers/autopilot/disable.js';

export type { AutopilotDisablePayload };

/** Payload must be a plain object (the cli schema declares zero properties, but
 *  the dispatch boundary should still reject primitive payloads). */
const payloadIsObject: Invariant<AutopilotDisablePayload> = ({ recordedPayload }) => {
  if (recordedPayload === null || typeof recordedPayload !== 'object' || Array.isArray(recordedPayload)) {
    return { violated: true, detail: `payload must be an object, got ${typeof recordedPayload}` };
  }
  return 'pass';
};

export const disableInvariants: ReadonlyArray<Invariant<AutopilotDisablePayload>> = [
  payloadIsObject,
];
