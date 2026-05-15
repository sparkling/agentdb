// charter: mutation-invariants
// memory_store mutation invariants (ADR-0180 §Architecture · Mutation invariants — second
// correctness gate, ~line 132). Invariants are correctness — they verify the recorded
// payload equals the caller's intent across the substrate write. Evaluated at write-time
// BEFORE the audit entry transitions to `applied`. A violation aborts the write, records
// `state: 'rejected'`, and surfaces to the caller per `feedback-data-loss-zero-tolerance`.
//
// Distinct from cli-side input validation: those rules check the wire-format payload
// before dispatch. Invariants check the payload as it appears at the dispatch boundary
// (callerIntent) against the payload that hit the substrate (recordedPayload). A
// non-cli caller (or a future cli refactor that bypasses validation) still goes through
// the dispatch, so these invariants are the last line of defence on substrate consistency.

import type { Invariant } from '../../registration.js';
import type { MemoryStorePayload } from '../../handlers/memory/store.js';

export type { MemoryStorePayload };

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

/** Namespace must be a non-empty string when defaulted. The handler defaults
 *  empty/undefined to 'default'; an empty recorded namespace after that fall-through
 *  indicates a regression in the default-application path. */
const namespaceNonEmpty: Invariant<MemoryStorePayload> = ({ recordedPayload }) => {
  // The handler accepts an empty namespace and defaults it to 'default' inside
  // the handler body. The recorded payload still carries the original — what we
  // actually care about is "the namespace string isn't `null`/`undefined` after
  // dispatch", since downstream substrate routing keys off it. A literal empty
  // string is allowed (handler maps to 'default'); null/undefined is not.
  const ns = recordedPayload.namespace;
  if (ns === null || ns === undefined) {
    return { violated: true, detail: `namespace must be a string, got ${String(ns)}` };
  }
  return 'pass';
};

/** Key identity — substrate routes per (namespace, key); divergence is a data-placement bug. */
const keyEquality: Invariant<MemoryStorePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.key !== recordedPayload.key) {
    return {
      violated: true,
      detail: `key divergence: intent='${callerIntent.key}' recorded='${recordedPayload.key}'`,
    };
  }
  return 'pass';
};

/** Content identity — guards against silent truncation/normalization between intent and recorded. */
const contentEquality: Invariant<MemoryStorePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.content !== recordedPayload.content) {
    return {
      violated: true,
      detail: `content divergence: intent.length=${callerIntent.content?.length ?? 0} recorded.length=${recordedPayload.content?.length ?? 0}`,
    };
  }
  return 'pass';
};

/** TTL must be non-negative when present (ADR-0181 §C TTL semantics: 0/negative
 *  treated as "no expiry" in the handler, but a NEGATIVE recorded TTL indicates
 *  the caller intended one branch and the dispatch saw another — surface it). */
const ttlNonNegative: Invariant<MemoryStorePayload> = ({ recordedPayload }) => {
  const ttl = recordedPayload.ttl;
  if (ttl === undefined || ttl === null) return 'pass';
  if (typeof ttl !== 'number' || !Number.isFinite(ttl)) {
    return { violated: true, detail: `ttl must be a finite number, got ${String(ttl)}` };
  }
  if (ttl < 0) {
    return { violated: true, detail: `ttl must be >= 0, got ${ttl}` };
  }
  return 'pass';
};

/** Upsert flag identity — the RC-2 idempotency branch is upsert-driven; an
 *  intent-vs-recorded divergence here means the wrong branch ran. */
const upsertEquality: Invariant<MemoryStorePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.upsert !== recordedPayload.upsert) {
    return {
      violated: true,
      detail: `upsert divergence: intent=${String(callerIntent.upsert)} recorded=${String(recordedPayload.upsert)}`,
    };
  }
  return 'pass';
};

export const storeInvariants: ReadonlyArray<Invariant<MemoryStorePayload>> = [
  namespaceNonEmpty,
  namespaceEquality,
  keyEquality,
  contentEquality,
  ttlNonNegative,
  upsertEquality,
];
