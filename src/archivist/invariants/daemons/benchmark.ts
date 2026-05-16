// charter: mutation-invariants
// daemon_runBenchmark mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { BenchmarkWorkerPayload } from '../../handlers/daemons/benchmark.js';

export type { BenchmarkWorkerPayload };

const VALID_MODES = new Set(['local', 'headless']);

const modeInEnum: Invariant<BenchmarkWorkerPayload> = ({ recordedPayload }) => {
  if (!VALID_MODES.has(recordedPayload.mode as string)) {
    return { violated: true, detail: `mode must be 'local' or 'headless', got ${JSON.stringify(recordedPayload.mode)}` };
  }
  return 'pass';
};

const timestampNonEmpty: Invariant<BenchmarkWorkerPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.timestamp;
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `timestamp must be a non-empty string, got ${typeof t}` };
  }
  return 'pass';
};

/** uptime must be a finite non-negative number when present. */
const uptimeNonNegative: Invariant<BenchmarkWorkerPayload> = ({ recordedPayload }) => {
  const u = recordedPayload.benchmarks?.uptime;
  if (u === undefined) return 'pass';
  if (typeof u !== 'number' || !Number.isFinite(u)) {
    return { violated: true, detail: `benchmarks.uptime must be a finite number, got ${String(u)}` };
  }
  if (u < 0) {
    return { violated: true, detail: `benchmarks.uptime must be >= 0, got ${u}` };
  }
  return 'pass';
};

export const benchmarkInvariants: ReadonlyArray<Invariant<BenchmarkWorkerPayload>> = [
  modeInEnum,
  timestampNonEmpty,
  uptimeNonNegative,
];
