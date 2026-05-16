// charter: mutation-invariants
// performance_benchmark mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler overwrites the `benchmark-volatile` namespace with one record per
// suite-iteration. Bad runId / suite / non-positive iterations would render the
// run unidentifiable in the audit chain.

import type { Invariant } from '../../registration.js';
import type { PerfBenchmarkPayload, BenchmarkRecord } from '../../handlers/performance/benchmark.js';

export type { PerfBenchmarkPayload };

const ID_MAX = 200;
const ITER_MAX = 1_000_000;

/** runId must be a non-empty string ≤200 chars — the audit chain keys per run. */
const runIdWellFormed: Invariant<PerfBenchmarkPayload> = ({ recordedPayload }) => {
  const id = recordedPayload.runId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `runId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `runId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** suite must be a non-empty string. */
const suiteNonEmpty: Invariant<PerfBenchmarkPayload> = ({ recordedPayload }) => {
  const s = recordedPayload.suite;
  if (typeof s !== 'string' || s.length === 0) {
    return { violated: true, detail: `suite must be a non-empty string, got ${typeof s} length=${(s as string)?.length ?? 0}` };
  }
  return 'pass';
};

/** iterations must be a finite positive integer in [1, 1_000_000]. */
const iterationsInRange: Invariant<PerfBenchmarkPayload> = ({ recordedPayload }) => {
  const n = recordedPayload.iterations;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    return { violated: true, detail: `iterations must be a finite integer, got ${String(n)}` };
  }
  if (n < 1 || n > ITER_MAX) {
    return { violated: true, detail: `iterations must be in [1, ${ITER_MAX}], got ${n}` };
  }
  return 'pass';
};

/** warmup must be a boolean. */
const warmupBoolean: Invariant<PerfBenchmarkPayload> = ({ recordedPayload }) => {
  if (typeof recordedPayload.warmup !== 'boolean') {
    return { violated: true, detail: `warmup must be a boolean, got ${typeof recordedPayload.warmup}` };
  }
  return 'pass';
};

/** results must be an array; each entry must carry the BenchmarkRecord
 *  invariant shape (id/name/type/results.{duration,iterations,opsPerSecond,memory}/
 *  createdAt). Only check the array + non-empty-string id/name to keep the
 *  invariant cheap. */
const resultsWellFormed: Invariant<PerfBenchmarkPayload> = ({ recordedPayload }) => {
  const r = recordedPayload.results;
  if (!Array.isArray(r)) {
    return { violated: true, detail: `results must be an array, got ${typeof r}` };
  }
  for (let i = 0; i < r.length; i++) {
    const rec = r[i] as BenchmarkRecord | undefined;
    if (!rec || typeof rec.id !== 'string' || rec.id.length === 0) {
      return { violated: true, detail: `results[${i}].id must be a non-empty string` };
    }
    if (typeof rec.name !== 'string' || rec.name.length === 0) {
      return { violated: true, detail: `results[${i}].name must be a non-empty string` };
    }
  }
  return 'pass';
};

/** runId identity — TAUTOLOGY TODAY. */
const runIdEquality: Invariant<PerfBenchmarkPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.runId !== recordedPayload.runId) {
    return { violated: true, detail: `runId divergence: intent='${callerIntent.runId}' recorded='${recordedPayload.runId}'` };
  }
  return 'pass';
};

export const benchmarkInvariants: ReadonlyArray<Invariant<PerfBenchmarkPayload>> = [
  runIdWellFormed,
  suiteNonEmpty,
  iterationsInRange,
  warmupBoolean,
  resultsWellFormed,
  runIdEquality,
];
