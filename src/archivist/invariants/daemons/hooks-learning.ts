// charter: mutation-invariants
// daemon_runHooksLearning mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { HooksLearningPayload } from '../../handlers/daemons/hooks-learning.js';

export type { HooksLearningPayload };

const VALID_TRIGGERS = new Set(['periodic', 'force']);

const triggerInEnum: Invariant<HooksLearningPayload> = ({ recordedPayload }) => {
  if (!VALID_TRIGGERS.has(recordedPayload.trigger as string)) {
    return { violated: true, detail: `trigger must be one of {periodic,force}, got ${JSON.stringify(recordedPayload.trigger)}` };
  }
  return 'pass';
};

const tsNonNegative: Invariant<HooksLearningPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.ts;
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    return { violated: true, detail: `ts must be a finite number, got ${String(t)}` };
  }
  if (t < 0) {
    return { violated: true, detail: `ts must be >= 0, got ${t}` };
  }
  return 'pass';
};

/** result.run counters must be non-negative. */
const runCountsNonNegative: Invariant<HooksLearningPayload> = ({ recordedPayload }) => {
  const r = recordedPayload.result?.run;
  if (!r) return 'pass';
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'number' && v < 0) {
      return { violated: true, detail: `result.run.${k} must be >= 0, got ${v}` };
    }
  }
  return 'pass';
};

export const hooksLearningInvariants: ReadonlyArray<Invariant<HooksLearningPayload>> = [
  triggerInEnum,
  tsNonNegative,
  runCountsNonNegative,
];
