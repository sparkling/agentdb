// charter: mutation-invariants
// system_reset mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler throws on `confirm: false`; this invariant array formalizes that
// destructive-overwrite contract for the audit chain.

import type { Invariant } from '../../registration.js';
import type { SystemResetPayload } from '../../handlers/system/reset.js';

export type { SystemResetPayload };

const VALID_COMPONENTS = new Set(['all', 'metrics', 'agents', 'tasks']);

/** confirm must be `true` — destructive overwrite requires explicit confirmation. */
const confirmIsTrue: Invariant<SystemResetPayload> = ({ recordedPayload }) => {
  if (recordedPayload.confirm !== true) {
    return { violated: true, detail: `confirm must be true for destructive reset, got ${String(recordedPayload.confirm)}` };
  }
  return 'pass';
};

/** component, when present, must be one of {all, metrics, agents, tasks}. */
const componentInEnum: Invariant<SystemResetPayload> = ({ recordedPayload }) => {
  const c = recordedPayload.component;
  if (c === undefined) return 'pass';
  if (!VALID_COMPONENTS.has(c as string)) {
    return { violated: true, detail: `component must be one of {all,metrics,agents,tasks}, got ${JSON.stringify(c)}` };
  }
  return 'pass';
};

/** confirm identity — TAUTOLOGY TODAY but doubles as a contract anchor for
 *  the audit-recorded destructive-overwrite shape. */
const confirmEquality: Invariant<SystemResetPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.confirm !== recordedPayload.confirm) {
    return { violated: true, detail: `confirm divergence: intent=${String(callerIntent.confirm)} recorded=${String(recordedPayload.confirm)}` };
  }
  return 'pass';
};

export const resetInvariants: ReadonlyArray<Invariant<SystemResetPayload>> = [
  confirmIsTrue,
  componentInEnum,
  confirmEquality,
];
