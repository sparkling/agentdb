// charter: mutation-invariants
// daemon_runConsolidate mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { ConsolidateWorkerPayload } from '../../handlers/daemons/consolidate.js';

export type { ConsolidateWorkerPayload };

const VALID_REASONS = new Set(['scheduled', 'session-end-nudge']);

const reasonInEnum: Invariant<ConsolidateWorkerPayload> = ({ recordedPayload }) => {
  if (!VALID_REASONS.has(recordedPayload.reason as string)) {
    return { violated: true, detail: `reason must be one of {scheduled,session-end-nudge}, got ${JSON.stringify(recordedPayload.reason)}` };
  }
  return 'pass';
};

const tsNonNegative: Invariant<ConsolidateWorkerPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.ts;
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    return { violated: true, detail: `ts must be a finite number, got ${String(t)}` };
  }
  if (t < 0) {
    return { violated: true, detail: `ts must be >= 0, got ${t}` };
  }
  return 'pass';
};

/** summary.patternsConsolidated must be a non-negative number. */
const summaryCountsNonNegative: Invariant<ConsolidateWorkerPayload> = ({ recordedPayload }) => {
  const s = recordedPayload.summary;
  if (!s) {
    return { violated: true, detail: `summary must be present` };
  }
  if (typeof s.patternsConsolidated === 'number' && s.patternsConsolidated < 0) {
    return { violated: true, detail: `summary.patternsConsolidated must be >= 0, got ${s.patternsConsolidated}` };
  }
  if (typeof s.memoryCleaned === 'number' && s.memoryCleaned < 0) {
    return { violated: true, detail: `summary.memoryCleaned must be >= 0, got ${s.memoryCleaned}` };
  }
  return 'pass';
};

export const consolidateInvariants: ReadonlyArray<Invariant<ConsolidateWorkerPayload>> = [
  reasonInEnum,
  tsNonNegative,
  summaryCountsNonNegative,
];
