// charter: mutation-invariants
// performance_report mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler appends a sample to rolling metrics history (cap 100). Out-of-range
// CPU/memory/latency would corrupt downstream observability dashboards.

import type { Invariant } from '../../registration.js';
import type { PerfReportPayload, PerfMetricsRecord } from '../../handlers/performance/report.js';

export type { PerfReportPayload };

/** sample must be a plain object with the expected sub-fields. We do a
 *  best-effort shape check — the audit chain reads the structured payload, so
 *  malformed samples must surface as rejected rather than silently lodged. */
const sampleWellFormed: Invariant<PerfReportPayload> = ({ recordedPayload }) => {
  const s = recordedPayload.sample as PerfMetricsRecord | undefined;
  if (!s || typeof s !== 'object') {
    return { violated: true, detail: `sample must be an object, got ${typeof s}` };
  }
  if (typeof s.timestamp !== 'string' || s.timestamp.length === 0) {
    return { violated: true, detail: `sample.timestamp must be a non-empty ISO string` };
  }
  if (!s.cpu || typeof s.cpu.usage !== 'number' || !Number.isFinite(s.cpu.usage)) {
    return { violated: true, detail: `sample.cpu.usage must be a finite number` };
  }
  if (!s.memory || typeof s.memory.used !== 'number' || !Number.isFinite(s.memory.used)) {
    return { violated: true, detail: `sample.memory.used must be a finite number` };
  }
  if (!s.latency || typeof s.latency.avg !== 'number' || !Number.isFinite(s.latency.avg)) {
    return { violated: true, detail: `sample.latency.avg must be a finite number` };
  }
  return 'pass';
};

/** cpu usage in [0, 100*cores] is not strictly enforced (Linux loadavg can
 *  exceed core count under heavy queueing), but a NEGATIVE value is always a
 *  caller bug. */
const cpuNonNegative: Invariant<PerfReportPayload> = ({ recordedPayload }) => {
  const u = recordedPayload.sample?.cpu?.usage;
  if (u === undefined) return 'pass';
  if (typeof u === 'number' && u < 0) {
    return { violated: true, detail: `sample.cpu.usage must be >= 0, got ${u}` };
  }
  return 'pass';
};

/** memory used/total must be non-negative finite numbers. */
const memoryNonNegative: Invariant<PerfReportPayload> = ({ recordedPayload }) => {
  const m = recordedPayload.sample?.memory;
  if (!m) return 'pass';
  if (typeof m.used === 'number' && m.used < 0) {
    return { violated: true, detail: `sample.memory.used must be >= 0, got ${m.used}` };
  }
  if (typeof m.total === 'number' && m.total < 0) {
    return { violated: true, detail: `sample.memory.total must be >= 0, got ${m.total}` };
  }
  return 'pass';
};

/** latency percentiles must respect p50 <= p95 <= p99 ordering when all present. */
const latencyOrdering: Invariant<PerfReportPayload> = ({ recordedPayload }) => {
  const l = recordedPayload.sample?.latency;
  if (!l) return 'pass';
  if (typeof l.p50 === 'number' && typeof l.p95 === 'number' && l.p50 > l.p95) {
    return { violated: true, detail: `latency.p50 (${l.p50}) > p95 (${l.p95}) violates ordering` };
  }
  if (typeof l.p95 === 'number' && typeof l.p99 === 'number' && l.p95 > l.p99) {
    return { violated: true, detail: `latency.p95 (${l.p95}) > p99 (${l.p99}) violates ordering` };
  }
  return 'pass';
};

/** timestamp identity — TAUTOLOGY TODAY. */
const timestampEquality: Invariant<PerfReportPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.sample?.timestamp !== recordedPayload.sample?.timestamp) {
    return { violated: true, detail: `sample.timestamp divergence: intent='${callerIntent.sample?.timestamp}' recorded='${recordedPayload.sample?.timestamp}'` };
  }
  return 'pass';
};

export const reportInvariants: ReadonlyArray<Invariant<PerfReportPayload>> = [
  sampleWellFormed,
  cpuNonNegative,
  memoryNonNegative,
  latencyOrdering,
  timestampEquality,
];
