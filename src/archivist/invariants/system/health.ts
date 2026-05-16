// charter: mutation-invariants
// system_health mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { SystemHealthPayload } from '../../handlers/system/health.js';

export type { SystemHealthPayload };

/** deep, when present, must be a boolean. */
const deepBoolean: Invariant<SystemHealthPayload> = ({ recordedPayload }) => {
  const d = recordedPayload.deep;
  if (d === undefined) return 'pass';
  if (typeof d !== 'boolean') {
    return { violated: true, detail: `deep must be a boolean when present, got ${typeof d}` };
  }
  return 'pass';
};

/** components, when present, must be an array of strings. */
const componentsWellFormed: Invariant<SystemHealthPayload> = ({ recordedPayload }) => {
  const c = recordedPayload.components;
  if (c === undefined) return 'pass';
  if (!Array.isArray(c)) {
    return { violated: true, detail: `components must be an array, got ${typeof c}` };
  }
  for (let i = 0; i < c.length; i++) {
    if (typeof c[i] !== 'string' || (c[i] as string).length === 0) {
      return { violated: true, detail: `components[${i}] must be a non-empty string, got ${typeof c[i]}` };
    }
  }
  return 'pass';
};

/** fix, when present, must be a boolean. */
const fixBoolean: Invariant<SystemHealthPayload> = ({ recordedPayload }) => {
  const f = recordedPayload.fix;
  if (f === undefined) return 'pass';
  if (typeof f !== 'boolean') {
    return { violated: true, detail: `fix must be a boolean when present, got ${typeof f}` };
  }
  return 'pass';
};

export const healthInvariants: ReadonlyArray<Invariant<SystemHealthPayload>> = [
  deepBoolean,
  componentsWellFormed,
  fixBoolean,
];
