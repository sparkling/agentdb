// charter: mutation-invariants
// config_import mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler validates `config` is a non-null plain object + filters dangerous
// keys at the head; these invariants formalize the contract for the audit chain.

import type { Invariant } from '../../registration.js';
import type { ConfigImportPayload } from '../../handlers/config/import.js';

export type { ConfigImportPayload };

/** config must be a non-null plain object (not array, not primitive). */
const configIsObject: Invariant<ConfigImportPayload> = ({ recordedPayload }) => {
  const c = recordedPayload.config;
  if (c === undefined || c === null || typeof c !== 'object' || Array.isArray(c)) {
    return { violated: true, detail: `config must be a plain object, got ${Array.isArray(c) ? 'array' : typeof c}` };
  }
  return 'pass';
};

/** scope, when present, must be a non-empty string. */
const scopeWellFormed: Invariant<ConfigImportPayload> = ({ recordedPayload }) => {
  const s = recordedPayload.scope;
  if (s === undefined) return 'pass';
  if (typeof s !== 'string' || s.length === 0) {
    return { violated: true, detail: `scope must be a non-empty string when present, got ${typeof s}` };
  }
  return 'pass';
};

/** merge, when present, must be a boolean. */
const mergeBoolean: Invariant<ConfigImportPayload> = ({ recordedPayload }) => {
  const m = recordedPayload.merge;
  if (m === undefined) return 'pass';
  if (typeof m !== 'boolean') {
    return { violated: true, detail: `merge must be a boolean when present, got ${typeof m}` };
  }
  return 'pass';
};

export const importInvariants: ReadonlyArray<Invariant<ConfigImportPayload>> = [
  configIsObject,
  scopeWellFormed,
  mergeBoolean,
];
