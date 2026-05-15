// charter: mutation-invariants
// memory_delete mutation invariants (ADR-0180 §Architecture · Mutation invariants — second
// correctness gate). Verifies the recorded delete-target matches the caller's intent.
// A regression where a handler resolves to a different row than the audit log claims
// would replay identically (tautological-replay problem, ADR-0180 §Mutation invariants);
// these invariants close that gap.

import type { Invariant } from '../../registration.js';

/**
 * memory_delete intent. Either `{namespace, key}` (the cli surface) or `{id}` (the
 * agentdb-backed direct surface) resolves the target row. The invariant verifies
 * whichever pair the caller supplied survives unchanged into the audit record.
 */
export interface MemoryDeletePayload {
  readonly namespace?: string;
  readonly key?: string;
  readonly id?: string;
}

/** Namespace identity when present on both sides. */
const namespaceEquality: Invariant<MemoryDeletePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.namespace !== recordedPayload.namespace) {
    return {
      violated: true,
      detail: `namespace divergence: intent='${String(callerIntent.namespace)}' recorded='${String(recordedPayload.namespace)}'`,
    };
  }
  return 'pass';
};

/** Key identity when present on both sides. */
const keyEquality: Invariant<MemoryDeletePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.key !== recordedPayload.key) {
    return {
      violated: true,
      detail: `key divergence: intent='${String(callerIntent.key)}' recorded='${String(recordedPayload.key)}'`,
    };
  }
  return 'pass';
};

/** Id identity when the agentdb-backed surface supplied an `id` instead. */
const idEquality: Invariant<MemoryDeletePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.id !== recordedPayload.id) {
    return {
      violated: true,
      detail: `id divergence: intent='${String(callerIntent.id)}' recorded='${String(recordedPayload.id)}'`,
    };
  }
  return 'pass';
};

export const deleteInvariants: ReadonlyArray<Invariant<MemoryDeletePayload>> = [
  namespaceEquality,
  keyEquality,
  idEquality,
];
