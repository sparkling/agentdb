// charter: mutation-invariants
// ruvllm_hnsw_create mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// Bad routerId or out-of-range dimensions/maxPatterns would create a router
// record that downstream HNSW operations can't honor.

import type { Invariant } from '../../registration.js';
import type { RuvllmHnswCreatePayload } from '../../handlers/ruvllm/hnsw-create.js';

export type { RuvllmHnswCreatePayload };

const ID_MAX = 200;
const DIM_MAX = 100_000; // ALBERT/BERT/Roberta-large topouts; > 100k is a misconfig
const PATTERN_MAX = 10_000_000; // 10M-pattern HNSW is at the upper-end of practical

/** routerId must be a non-empty string ≤200 chars. */
const routerIdWellFormed: Invariant<RuvllmHnswCreatePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.routerId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `routerId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `routerId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** routerId identity — TAUTOLOGY TODAY. */
const routerIdEquality: Invariant<RuvllmHnswCreatePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.routerId !== recordedPayload.routerId) {
    return { violated: true, detail: `routerId divergence: intent='${callerIntent.routerId}' recorded='${recordedPayload.routerId}'` };
  }
  return 'pass';
};

/** config.dimensions must be a finite positive integer (HNSW vector dim). */
const dimensionsPositiveInteger: Invariant<RuvllmHnswCreatePayload> = ({ recordedPayload }) => {
  const d = recordedPayload.config?.dimensions;
  if (typeof d !== 'number' || !Number.isFinite(d) || !Number.isInteger(d)) {
    return { violated: true, detail: `config.dimensions must be a finite integer, got ${String(d)}` };
  }
  if (d < 1 || d > DIM_MAX) {
    return { violated: true, detail: `config.dimensions must be in [1, ${DIM_MAX}], got ${d}` };
  }
  return 'pass';
};

/** config.maxPatterns must be a finite positive integer. */
const maxPatternsPositiveInteger: Invariant<RuvllmHnswCreatePayload> = ({ recordedPayload }) => {
  const m = recordedPayload.config?.maxPatterns;
  if (typeof m !== 'number' || !Number.isFinite(m) || !Number.isInteger(m)) {
    return { violated: true, detail: `config.maxPatterns must be a finite integer, got ${String(m)}` };
  }
  if (m < 1 || m > PATTERN_MAX) {
    return { violated: true, detail: `config.maxPatterns must be in [1, ${PATTERN_MAX}], got ${m}` };
  }
  return 'pass';
};

/** config.efSearch, when present, must be a finite positive integer. */
const efSearchPositiveInteger: Invariant<RuvllmHnswCreatePayload> = ({ recordedPayload }) => {
  const ef = recordedPayload.config?.efSearch;
  if (ef === undefined) return 'pass';
  if (typeof ef !== 'number' || !Number.isFinite(ef) || !Number.isInteger(ef)) {
    return { violated: true, detail: `config.efSearch must be a finite integer when present, got ${String(ef)}` };
  }
  if (ef < 1) {
    return { violated: true, detail: `config.efSearch must be >= 1, got ${ef}` };
  }
  return 'pass';
};

export const hnswCreateInvariants: ReadonlyArray<Invariant<RuvllmHnswCreatePayload>> = [
  routerIdWellFormed,
  routerIdEquality,
  dimensionsPositiveInteger,
  maxPatternsPositiveInteger,
  efSearchPositiveInteger,
];
