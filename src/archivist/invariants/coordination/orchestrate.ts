// charter: mutation-invariants
// coordination_orchestrate mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler appends to `store.orchestrations[]` with a 100-entry ring-buffer cap.
// Empty task, out-of-enum strategy, or non-finite timeout would corrupt the
// orchestration record (read by downstream observability tooling).

import type { Invariant } from '../../registration.js';
import type { CoordinationOrchestratePayload } from '../../handlers/coordination/orchestrate.js';

export type { CoordinationOrchestratePayload };

const VALID_STRATEGIES = new Set(['parallel', 'sequential', 'pipeline', 'broadcast']);
const TASK_MAX = 10_000;
const AGENTS_MAX = 256;

/** task must be a non-empty string ≤10KB — required at the cli boundary. */
const taskNonEmpty: Invariant<CoordinationOrchestratePayload> = ({ recordedPayload }) => {
  const t = recordedPayload.task;
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `task must be a non-empty string, got ${typeof t} length=${(t as string)?.length ?? 0}` };
  }
  if (t.length > TASK_MAX) {
    return { violated: true, detail: `task length ${t.length} exceeds max ${TASK_MAX}` };
  }
  return 'pass';
};

/** task identity — TAUTOLOGY TODAY (dispatch passes same object); ships as
 *  contract spec for the cli boundary flip per ADR-0181 §H. */
const taskEquality: Invariant<CoordinationOrchestratePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.task !== recordedPayload.task) {
    return { violated: true, detail: `task divergence: intent.length=${callerIntent.task?.length ?? 0} recorded.length=${recordedPayload.task?.length ?? 0}` };
  }
  return 'pass';
};

/** strategy, when present, must be one of {parallel,sequential,pipeline,broadcast}. */
const strategyInEnum: Invariant<CoordinationOrchestratePayload> = ({ recordedPayload }) => {
  const s = recordedPayload.strategy;
  if (s === undefined) return 'pass';
  if (!VALID_STRATEGIES.has(s as string)) {
    return { violated: true, detail: `strategy must be one of {parallel,sequential,pipeline,broadcast}, got ${JSON.stringify(s)}` };
  }
  return 'pass';
};

/** agents, when present, must be an array of non-empty strings (256 cap to
 *  prevent unbounded fan-out into a coordination orchestration record). */
const agentsWellFormed: Invariant<CoordinationOrchestratePayload> = ({ recordedPayload }) => {
  const a = recordedPayload.agents;
  if (a === undefined) return 'pass';
  if (!Array.isArray(a)) {
    return { violated: true, detail: `agents must be an array, got ${typeof a}` };
  }
  if (a.length > AGENTS_MAX) {
    return { violated: true, detail: `agents length ${a.length} exceeds max ${AGENTS_MAX}` };
  }
  for (let i = 0; i < a.length; i++) {
    if (typeof a[i] !== 'string' || (a[i] as string).length === 0) {
      return { violated: true, detail: `agents[${i}] must be a non-empty string, got ${typeof a[i]}` };
    }
  }
  return 'pass';
};

/** timeout, when present, must be a finite non-negative number (milliseconds). */
const timeoutNonNegative: Invariant<CoordinationOrchestratePayload> = ({ recordedPayload }) => {
  const t = recordedPayload.timeout;
  if (t === undefined) return 'pass';
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    return { violated: true, detail: `timeout must be a finite number, got ${String(t)}` };
  }
  if (t < 0) {
    return { violated: true, detail: `timeout must be >= 0, got ${t}` };
  }
  return 'pass';
};

export const orchestrateInvariants: ReadonlyArray<Invariant<CoordinationOrchestratePayload>> = [
  taskNonEmpty,
  taskEquality,
  strategyInEnum,
  agentsWellFormed,
  timeoutNonNegative,
];
