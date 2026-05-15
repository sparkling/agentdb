// charter: mutation-invariants
// memory_store mutation invariants (ADR-0180 §Architecture · Mutation invariants — second
// correctness gate, ~line 132). These are NOT guards (guards are policy: PII, size limits);
// invariants are correctness — they verify the recorded payload equals the caller's intent
// across the substrate write. Evaluated at write-time BEFORE the audit entry transitions
// to `applied`. A violation aborts the write, records `state: 'rejected'`, and surfaces
// to the caller per `feedback-data-loss-zero-tolerance`.
//
// Baseline (verbatim from ADR-0180 §Mutation invariants): memory_store →
// {namespace, content_bytes, embedding_dim} equality between intent and recorded.

import type { Invariant } from '../../registration.js';

/**
 * Caller intent / recorded payload shape for memory_store mutations.
 * Mirrors the cli `routeMemoryOp` "store" intent; the byte length is captured at
 * intent-open so the invariant can verify the payload that hit substrate equals
 * the payload the caller staged (a normalization or trim regression would diverge
 * the two byte counts even when `content` looks identical).
 */
export interface MemoryStorePayload {
  readonly namespace: string;
  readonly key: string;
  readonly content: string;
  readonly contentBytes: number;
  readonly embeddingDim?: number;
  readonly metadata?: Record<string, unknown>;
}

/** Namespace identity — pre/post must match exactly. */
const namespaceEquality: Invariant<MemoryStorePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.namespace !== recordedPayload.namespace) {
    return {
      violated: true,
      detail: `namespace divergence: intent='${callerIntent.namespace}' recorded='${recordedPayload.namespace}'`,
    };
  }
  return 'pass';
};

/** Content byte-count identity — guards against silent truncation/normalization. */
const contentBytesEquality: Invariant<MemoryStorePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.contentBytes !== recordedPayload.contentBytes) {
    return {
      violated: true,
      detail: `content_bytes divergence: intent=${callerIntent.contentBytes} recorded=${recordedPayload.contentBytes}`,
    };
  }
  return 'pass';
};

/**
 * Embedding-dimension identity — both sides must declare the same dimension (or both
 * `undefined`, when the store is a content-only namespace). Catches the regression
 * where a handler embeds under a different model than the audit entry records.
 */
const embeddingDimEquality: Invariant<MemoryStorePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.embeddingDim !== recordedPayload.embeddingDim) {
    return {
      violated: true,
      detail: `embedding_dim divergence: intent=${String(callerIntent.embeddingDim)} recorded=${String(recordedPayload.embeddingDim)}`,
    };
  }
  return 'pass';
};

export const storeInvariants: ReadonlyArray<Invariant<MemoryStorePayload>> = [
  namespaceEquality,
  contentBytesEquality,
  embeddingDimEquality,
];
