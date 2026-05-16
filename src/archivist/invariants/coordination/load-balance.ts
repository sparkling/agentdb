// charter: mutation-invariants
// coordination_load_balance mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler mutates `store.loadBalance.{algorithm,weights}` and (on distribute)
// the per-node load counter. Out-of-enum algorithm / non-finite weight values
// would corrupt the dispatch algorithm logic.

import type { Invariant } from '../../registration.js';
import type { CoordinationLoadBalancePayload } from '../../handlers/coordination/load-balance.js';

export type { CoordinationLoadBalancePayload };

const VALID_ACTIONS = new Set(['get', 'set', 'distribute']);
const VALID_ALGORITHMS = new Set(['round-robin', 'least-connections', 'weighted', 'adaptive']);
const TASK_MAX = 10_000;

/** action must be one of {get, set, distribute} when present. */
const actionInEnum: Invariant<CoordinationLoadBalancePayload> = ({ recordedPayload }) => {
  const a = recordedPayload.action;
  if (a === undefined) return 'pass';
  if (!VALID_ACTIONS.has(a as string)) {
    return { violated: true, detail: `action must be one of {get,set,distribute}, got ${JSON.stringify(a)}` };
  }
  return 'pass';
};

/** algorithm must be one of {round-robin, least-connections, weighted, adaptive}. */
const algorithmInEnum: Invariant<CoordinationLoadBalancePayload> = ({ recordedPayload }) => {
  const a = recordedPayload.algorithm;
  if (a === undefined) return 'pass';
  if (!VALID_ALGORITHMS.has(a as string)) {
    return { violated: true, detail: `algorithm must be one of {round-robin,least-connections,weighted,adaptive}, got ${JSON.stringify(a)}` };
  }
  return 'pass';
};

/** weights must be a plain object with finite-number values. A non-finite weight
 *  would silently rank nodes as Infinity / NaN in the weighted/adaptive path. */
const weightsWellFormed: Invariant<CoordinationLoadBalancePayload> = ({ recordedPayload }) => {
  const w = recordedPayload.weights;
  if (w === undefined) return 'pass';
  if (typeof w !== 'object' || w === null || Array.isArray(w)) {
    return { violated: true, detail: `weights must be an object, got ${typeof w}` };
  }
  for (const [k, v] of Object.entries(w)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { violated: true, detail: `weights['${k}'] must be a finite number, got ${String(v)}` };
    }
    if (v < 0) {
      return { violated: true, detail: `weights['${k}'] must be >= 0, got ${v}` };
    }
  }
  return 'pass';
};

/** task, when present, must be a non-empty string ≤10KB. */
const taskWellFormed: Invariant<CoordinationLoadBalancePayload> = ({ recordedPayload }) => {
  const t = recordedPayload.task;
  if (t === undefined) return 'pass';
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `task must be a non-empty string when present, got ${typeof t} length=${(t as string)?.length ?? 0}` };
  }
  if (t.length > TASK_MAX) {
    return { violated: true, detail: `task length ${t.length} exceeds max ${TASK_MAX}` };
  }
  return 'pass';
};

/** action identity — TAUTOLOGY TODAY (dispatch passes same object). */
const actionEquality: Invariant<CoordinationLoadBalancePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.action !== recordedPayload.action) {
    return { violated: true, detail: `action divergence: intent='${String(callerIntent.action)}' recorded='${String(recordedPayload.action)}'` };
  }
  return 'pass';
};

export const loadBalanceInvariants: ReadonlyArray<Invariant<CoordinationLoadBalancePayload>> = [
  actionInEnum,
  algorithmInEnum,
  weightsWellFormed,
  taskWellFormed,
  actionEquality,
];
