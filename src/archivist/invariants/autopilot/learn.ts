// charter: mutation-invariants
// autopilot_learn mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler is a Phase 5+ carry-forward stub (throws on dispatch); the invariant
// shape is minimal payload-shape. When the AutopilotLearner capability lands the
// invariants expand to cover the recorded metrics / pattern shape.

import type { Invariant } from '../../registration.js';
import type { AutopilotLearnPayload } from '../../handlers/autopilot/learn.js';

export type { AutopilotLearnPayload };

const payloadIsObject: Invariant<AutopilotLearnPayload> = ({ recordedPayload }) => {
  if (recordedPayload === null || typeof recordedPayload !== 'object' || Array.isArray(recordedPayload)) {
    return { violated: true, detail: `payload must be an object, got ${typeof recordedPayload}` };
  }
  return 'pass';
};

export const learnInvariants: ReadonlyArray<Invariant<AutopilotLearnPayload>> = [
  payloadIsObject,
];
