// charter: mutation-invariants
// memory_retrieve READ-handler invariants (ADR-0180 §Architecture · Mutation invariants).
//
// TODO(ADR-0181 #104): read handlers don't accept an `invariants:` opt today.
// Ships as contract spec.

import type { Invariant } from '../../registration.js';
import type { MemoryRetrieveQuery } from '../../handlers/memory/retrieve.js';

export type { MemoryRetrieveQuery };

const NAMESPACE_MAX = 200;
const KEY_MAX = 500;
const ID_MAX = 200;

/** namespace, when present, must be a non-empty string. */
const namespaceWellFormed: Invariant<MemoryRetrieveQuery> = ({ recordedPayload }) => {
  const n = recordedPayload.namespace;
  if (n === undefined) return 'pass';
  if (typeof n !== 'string' || n.length === 0) {
    return { violated: true, detail: `namespace must be a non-empty string when present, got ${typeof n}` };
  }
  if (n.length > NAMESPACE_MAX) {
    return { violated: true, detail: `namespace length ${n.length} exceeds max ${NAMESPACE_MAX}` };
  }
  return 'pass';
};

/** key, when present, must be a non-empty string ≤500 chars. */
const keyWellFormed: Invariant<MemoryRetrieveQuery> = ({ recordedPayload }) => {
  const k = recordedPayload.key;
  if (k === undefined) return 'pass';
  if (typeof k !== 'string' || k.length === 0) {
    return { violated: true, detail: `key must be a non-empty string when present, got ${typeof k}` };
  }
  if (k.length > KEY_MAX) {
    return { violated: true, detail: `key length ${k.length} exceeds max ${KEY_MAX}` };
  }
  return 'pass';
};

/** id, when present, must be a non-empty string ≤200 chars. */
const idWellFormed: Invariant<MemoryRetrieveQuery> = ({ recordedPayload }) => {
  const i = recordedPayload.id;
  if (i === undefined) return 'pass';
  if (typeof i !== 'string' || i.length === 0) {
    return { violated: true, detail: `id must be a non-empty string when present, got ${typeof i}` };
  }
  if (i.length > ID_MAX) {
    return { violated: true, detail: `id length ${i.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

export const retrieveInvariants: ReadonlyArray<Invariant<MemoryRetrieveQuery>> = [
  namespaceWellFormed,
  keyWellFormed,
  idWellFormed,
];
