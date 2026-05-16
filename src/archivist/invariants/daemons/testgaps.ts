// charter: mutation-invariants
// daemon_runTestGaps mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { TestGapsWorkerPayload } from '../../handlers/daemons/testgaps.js';

export type { TestGapsWorkerPayload };

const VALID_MODES = new Set(['local', 'headless']);

const modeInEnum: Invariant<TestGapsWorkerPayload> = ({ recordedPayload }) => {
  if (!VALID_MODES.has(recordedPayload.mode as string)) {
    return { violated: true, detail: `mode must be 'local' or 'headless', got ${JSON.stringify(recordedPayload.mode)}` };
  }
  return 'pass';
};

const timestampNonEmpty: Invariant<TestGapsWorkerPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.timestamp;
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `timestamp must be a non-empty string, got ${typeof t}` };
  }
  return 'pass';
};

export const testGapsInvariants: ReadonlyArray<Invariant<TestGapsWorkerPayload>> = [
  modeInEnum,
  timestampNonEmpty,
];
