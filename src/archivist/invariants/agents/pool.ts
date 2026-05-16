// charter: mutation-invariants
// agent_pool mutation invariants (ADR-0181 §H).
// Pool actions branch on `action` ∈ {scale,drain,fill}. ('status' is read-only
// and rejected by the handler.) Scale needs a finite targetSize; an out-of-
// range value either does nothing (negative) or floods the store with minted
// agents (very large).

import type { Invariant } from '../../registration.js';
import type { AgentPoolPayload } from '../../handlers/agents/pool.js';

export type { AgentPoolPayload };

const VALID_MUTATING_ACTIONS = new Set(['scale', 'drain', 'fill']);
const TARGET_SIZE_MAX = 1_000;
const AGENT_TYPE_MAX = 200;

/** action must be one of the mutating variants {scale, drain, fill}.
 *  The handler explicitly rejects 'status' (read-only); enforcing here at
 *  the invariant boundary surfaces routing mistakes loudly. */
const actionInMutatingEnum: Invariant<AgentPoolPayload> = ({ recordedPayload }) => {
  const a = recordedPayload.action;
  if (typeof a !== 'string' || !VALID_MUTATING_ACTIONS.has(a)) {
    return { violated: true, detail: `action must be one of {scale,drain,fill}, got ${JSON.stringify(a)}` };
  }
  return 'pass';
};

/** action identity — TAUTOLOGY today; ships as contract spec. */
const actionEquality: Invariant<AgentPoolPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.action !== recordedPayload.action) {
    return {
      violated: true,
      detail: `action divergence: intent='${callerIntent.action}' recorded='${recordedPayload.action}'`,
    };
  }
  return 'pass';
};

/** targetSize must be a non-negative finite integer in [0, 1000] when present.
 *  Scale uses this as the desired pool size; a NaN/Infinity/huge value
 *  would either no-op silently or mint runaway agents. */
const targetSizeBoundedWhenPresent: Invariant<AgentPoolPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.targetSize;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'number' || !Number.isFinite(t) || !Number.isInteger(t)) {
    return { violated: true, detail: `targetSize must be a finite integer when present, got ${String(t)}` };
  }
  if (t < 0 || t > TARGET_SIZE_MAX) {
    return { violated: true, detail: `targetSize must be in [0,${TARGET_SIZE_MAX}], got ${t}` };
  }
  return 'pass';
};

/** agentType (optional) must be a non-empty string ≤200 chars when present. */
const agentTypeBoundedWhenPresent: Invariant<AgentPoolPayload> = ({ recordedPayload }) => {
  const at = recordedPayload.agentType;
  if (at === undefined || at === null) return 'pass';
  if (typeof at !== 'string' || at.length === 0) {
    return { violated: true, detail: `agentType must be a non-empty string when present, got ${typeof at} length=${(at as string)?.length ?? 0}` };
  }
  if (at.length > AGENT_TYPE_MAX) {
    return { violated: true, detail: `agentType length ${at.length} exceeds max ${AGENT_TYPE_MAX}` };
  }
  return 'pass';
};

export const poolInvariants: ReadonlyArray<Invariant<AgentPoolPayload>> = [
  actionInMutatingEnum,
  actionEquality,
  targetSizeBoundedWhenPresent,
  agentTypeBoundedWhenPresent,
];
