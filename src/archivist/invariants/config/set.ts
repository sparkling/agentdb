// charter: mutation-invariants
// config_set mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler validates `key` non-empty + `value !== undefined` ADR-0094 P11/P12
// at the head; these invariants formalize that contract for the audit chain.

import type { Invariant } from '../../registration.js';
import type { ConfigSetPayload } from '../../handlers/config/set.js';

export type { ConfigSetPayload };

const KEY_MAX = 500;

/** key must be a non-empty string ≤500 chars (dot notation supported). */
const keyNonEmpty: Invariant<ConfigSetPayload> = ({ recordedPayload }) => {
  const k = recordedPayload.key;
  if (typeof k !== 'string' || k.length === 0) {
    return { violated: true, detail: `key must be a non-empty string, got ${typeof k} length=${(k as string)?.length ?? 0}` };
  }
  if (k.length > KEY_MAX) {
    return { violated: true, detail: `key length ${k.length} exceeds max ${KEY_MAX}` };
  }
  return 'pass';
};

/** value must NOT be undefined — pass null explicitly to clear. */
const valueDefined: Invariant<ConfigSetPayload> = ({ recordedPayload }) => {
  if (recordedPayload.value === undefined) {
    return { violated: true, detail: `value is required (pass null explicitly to clear the key)` };
  }
  return 'pass';
};

/** scope, when present, must be a non-empty string. */
const scopeWellFormed: Invariant<ConfigSetPayload> = ({ recordedPayload }) => {
  const s = recordedPayload.scope;
  if (s === undefined) return 'pass';
  if (typeof s !== 'string' || s.length === 0) {
    return { violated: true, detail: `scope must be a non-empty string when present, got ${typeof s}` };
  }
  return 'pass';
};

/** key identity — TAUTOLOGY TODAY. */
const keyEquality: Invariant<ConfigSetPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.key !== recordedPayload.key) {
    return { violated: true, detail: `key divergence: intent='${callerIntent.key}' recorded='${recordedPayload.key}'` };
  }
  return 'pass';
};

export const setInvariants: ReadonlyArray<Invariant<ConfigSetPayload>> = [
  keyNonEmpty,
  valueDefined,
  scopeWellFormed,
  keyEquality,
];
