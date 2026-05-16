// charter: mutation-invariants
// ruvllm_hnsw_add mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// Bad routerId / name or non-finite embedding values would corrupt the router's
// journal (HNSW replay reads embedding values as Float32).

import type { Invariant } from '../../registration.js';
import type { RuvllmHnswAddPayload } from '../../handlers/ruvllm/hnsw-add.js';

export type { RuvllmHnswAddPayload };

const ID_MAX = 200;
const NAME_MAX = 500;
const EMBEDDING_MAX = 100_000;

/** routerId must be a non-empty string ≤200 chars. */
const routerIdWellFormed: Invariant<RuvllmHnswAddPayload> = ({ recordedPayload }) => {
  const id = recordedPayload.routerId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `routerId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `routerId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** name must be a non-empty string ≤500 chars. */
const nameNonEmpty: Invariant<RuvllmHnswAddPayload> = ({ recordedPayload }) => {
  const n = recordedPayload.name;
  if (typeof n !== 'string' || n.length === 0) {
    return { violated: true, detail: `name must be a non-empty string, got ${typeof n} length=${(n as string)?.length ?? 0}` };
  }
  if (n.length > NAME_MAX) {
    return { violated: true, detail: `name length ${n.length} exceeds max ${NAME_MAX}` };
  }
  return 'pass';
};

/** embedding must be a non-empty array of finite numbers ≤100k dims. A NaN /
 *  Infinity / oversized vector would silently corrupt HNSW. */
const embeddingWellFormed: Invariant<RuvllmHnswAddPayload> = ({ recordedPayload }) => {
  const e = recordedPayload.embedding;
  if (!Array.isArray(e)) {
    return { violated: true, detail: `embedding must be an array, got ${typeof e}` };
  }
  if (e.length === 0) {
    return { violated: true, detail: `embedding must be non-empty` };
  }
  if (e.length > EMBEDDING_MAX) {
    return { violated: true, detail: `embedding length ${e.length} exceeds max ${EMBEDDING_MAX}` };
  }
  for (let i = 0; i < e.length; i++) {
    if (typeof e[i] !== 'number' || !Number.isFinite(e[i])) {
      return { violated: true, detail: `embedding[${i}] must be a finite number, got ${String(e[i])}` };
    }
  }
  return 'pass';
};

/** routerId identity — TAUTOLOGY TODAY. */
const routerIdEquality: Invariant<RuvllmHnswAddPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.routerId !== recordedPayload.routerId) {
    return { violated: true, detail: `routerId divergence: intent='${callerIntent.routerId}' recorded='${recordedPayload.routerId}'` };
  }
  return 'pass';
};

export const hnswAddInvariants: ReadonlyArray<Invariant<RuvllmHnswAddPayload>> = [
  routerIdWellFormed,
  nameNonEmpty,
  embeddingWellFormed,
  routerIdEquality,
];
