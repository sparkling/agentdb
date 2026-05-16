// charter: mutation-invariants
// autopilot_enable mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler already throws on non-string / empty mode at the head; these
// invariants formalize that contract for the audit chain (the throw is the
// runtime gate; the invariant is the verdict-recorded gate).

import type { Invariant } from '../../registration.js';
import type { AutopilotEnablePayload } from '../../handlers/autopilot/enable.js';

export type { AutopilotEnablePayload };

const MODE_MAX = 100;

/** mode, when present, must be a non-empty string ≤100 chars. */
const modeWellFormed: Invariant<AutopilotEnablePayload> = ({ recordedPayload }) => {
  const m = recordedPayload.mode;
  if (m === undefined) return 'pass';
  if (typeof m !== 'string' || m.length === 0) {
    return { violated: true, detail: `mode must be a non-empty string when present, got ${typeof m} length=${(m as string)?.length ?? 0}` };
  }
  if (m.length > MODE_MAX) {
    return { violated: true, detail: `mode length ${m.length} exceeds max ${MODE_MAX}` };
  }
  return 'pass';
};

/** mode identity — TAUTOLOGY TODAY. */
const modeEquality: Invariant<AutopilotEnablePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.mode !== recordedPayload.mode) {
    return { violated: true, detail: `mode divergence: intent='${String(callerIntent.mode)}' recorded='${String(recordedPayload.mode)}'` };
  }
  return 'pass';
};

export const enableInvariants: ReadonlyArray<Invariant<AutopilotEnablePayload>> = [
  modeWellFormed,
  modeEquality,
];
