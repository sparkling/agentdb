// charter: mutation-invariants
// agentdb_reflexion_retrieve read-handler invariants (ADR-0181 §H).
// READ handler — RegisterReadOpts doesn't accept invariants today, so these
// ship as the contract spec. TODO(ADR-0180 §Read-path return shape):
// add post-dispatch RankedResults<ReflexionEpisodeHit> guards (similarity
// monotonic, reward in [0,1]) when the return-shape design lands.

import type { Invariant } from '../../registration.js';
import type { AgentdbReflexionRetrieveQuery } from '../../handlers/agentdb/reflexion-retrieve.js';

export type { AgentdbReflexionRetrieveQuery };

const TASK_MAX = 10_000;
const K_MAX = 1_000;

const taskWellFormed: Invariant<AgentdbReflexionRetrieveQuery> = ({ recordedPayload }) => {
  const t = recordedPayload.task;
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `task must be a non-empty string, got ${typeof t} length=${(t as string)?.length ?? 0}` };
  }
  if (t.length > TASK_MAX) {
    return { violated: true, detail: `task length ${t.length} exceeds max ${TASK_MAX}` };
  }
  return 'pass';
};

const kInRangeWhenPresent: Invariant<AgentdbReflexionRetrieveQuery> = ({ recordedPayload }) => {
  const k = recordedPayload.k;
  if (k === undefined || k === null) return 'pass';
  if (typeof k !== 'number' || !Number.isFinite(k) || !Number.isInteger(k)) {
    return { violated: true, detail: `k must be a finite integer when present, got ${String(k)}` };
  }
  if (k < 1 || k > K_MAX) {
    return { violated: true, detail: `k must be in [1,${K_MAX}], got ${k}` };
  }
  return 'pass';
};

const onlyFailuresBooleanWhenPresent: Invariant<AgentdbReflexionRetrieveQuery> = ({ recordedPayload }) => {
  const f = recordedPayload.onlyFailures;
  if (f === undefined || f === null) return 'pass';
  if (typeof f !== 'boolean') {
    return { violated: true, detail: `onlyFailures must be a boolean when present, got ${typeof f}` };
  }
  return 'pass';
};

const onlySuccessesBooleanWhenPresent: Invariant<AgentdbReflexionRetrieveQuery> = ({ recordedPayload }) => {
  const s = recordedPayload.onlySuccesses;
  if (s === undefined || s === null) return 'pass';
  if (typeof s !== 'boolean') {
    return { violated: true, detail: `onlySuccesses must be a boolean when present, got ${typeof s}` };
  }
  return 'pass';
};

const minRewardInRangeWhenPresent: Invariant<AgentdbReflexionRetrieveQuery> = ({ recordedPayload }) => {
  const m = recordedPayload.minReward;
  if (m === undefined || m === null) return 'pass';
  if (typeof m !== 'number' || !Number.isFinite(m)) {
    return { violated: true, detail: `minReward must be a finite number when present, got ${String(m)}` };
  }
  if (m < 0 || m > 1) {
    return { violated: true, detail: `minReward must be in [0,1], got ${m}` };
  }
  return 'pass';
};

export const reflexionRetrieveInvariants: ReadonlyArray<Invariant<AgentdbReflexionRetrieveQuery>> = [
  taskWellFormed,
  kInRangeWhenPresent,
  onlyFailuresBooleanWhenPresent,
  onlySuccessesBooleanWhenPresent,
  minRewardInRangeWhenPresent,
];
