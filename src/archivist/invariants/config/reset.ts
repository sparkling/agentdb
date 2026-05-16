// charter: mutation-invariants
// config_reset mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { ConfigResetPayload } from '../../handlers/config/reset.js';

export type { ConfigResetPayload };

const KEY_MAX = 500;

/** key, when present, must be a non-empty string ≤500 chars. Absence means
 *  "reset the whole scope to defaults" (the cli surface). */
const keyWellFormed: Invariant<ConfigResetPayload> = ({ recordedPayload }) => {
  const k = recordedPayload.key;
  if (k === undefined) return 'pass';
  if (typeof k !== 'string' || k.length === 0) {
    return { violated: true, detail: `key must be a non-empty string when present, got ${typeof k} length=${(k as string)?.length ?? 0}` };
  }
  if (k.length > KEY_MAX) {
    return { violated: true, detail: `key length ${k.length} exceeds max ${KEY_MAX}` };
  }
  return 'pass';
};

/** scope, when present, must be a non-empty string. */
const scopeWellFormed: Invariant<ConfigResetPayload> = ({ recordedPayload }) => {
  const s = recordedPayload.scope;
  if (s === undefined) return 'pass';
  if (typeof s !== 'string' || s.length === 0) {
    return { violated: true, detail: `scope must be a non-empty string when present, got ${typeof s}` };
  }
  return 'pass';
};

export const resetInvariants: ReadonlyArray<Invariant<ConfigResetPayload>> = [
  keyWellFormed,
  scopeWellFormed,
];
