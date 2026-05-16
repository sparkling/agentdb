// charter: mutation-invariants
// agentdb_reflexion_store mutation invariants (ADR-0181 §H).
// Writes a ReflexionMemory episode into the episodes + episode_embeddings
// tables. The cli validates session_id ≤500, task ≤10KB, reward via
// validateScore; these invariants ship the contract spec at the dispatch
// boundary so non-cli callers can't sneak invalid records into the offline
// RL replay store.

import type { Invariant } from '../../registration.js';
import type { AgentdbReflexionStorePayload } from '../../handlers/agentdb/reflexion-store.js';

export type { AgentdbReflexionStorePayload };

const SESSION_ID_MAX = 500;
const TASK_MAX = 10_000;

const sessionIdWellFormed: Invariant<AgentdbReflexionStorePayload> = ({ recordedPayload }) => {
  const s = recordedPayload.session_id;
  if (typeof s !== 'string' || s.length === 0) {
    return { violated: true, detail: `session_id must be a non-empty string, got ${typeof s} length=${(s as string)?.length ?? 0}` };
  }
  if (s.length > SESSION_ID_MAX) {
    return { violated: true, detail: `session_id length ${s.length} exceeds max ${SESSION_ID_MAX}` };
  }
  return 'pass';
};

/** session_id identity — TAUTOLOGY today; ships as contract spec. */
const sessionIdEquality: Invariant<AgentdbReflexionStorePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.session_id !== recordedPayload.session_id) {
    return {
      violated: true,
      detail: `session_id divergence: intent='${callerIntent.session_id}' recorded='${recordedPayload.session_id}'`,
    };
  }
  return 'pass';
};

const taskWellFormed: Invariant<AgentdbReflexionStorePayload> = ({ recordedPayload }) => {
  const t = recordedPayload.task;
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `task must be a non-empty string, got ${typeof t} length=${(t as string)?.length ?? 0}` };
  }
  if (t.length > TASK_MAX) {
    return { violated: true, detail: `task length ${t.length} exceeds max ${TASK_MAX}` };
  }
  return 'pass';
};

/** reward must be finite ∈ [0, 1] (cli validateScore). */
const rewardInRange: Invariant<AgentdbReflexionStorePayload> = ({ recordedPayload }) => {
  const r = recordedPayload.reward;
  if (typeof r !== 'number' || !Number.isFinite(r)) {
    return { violated: true, detail: `reward must be a finite number, got ${String(r)}` };
  }
  if (r < 0 || r > 1) {
    return { violated: true, detail: `reward must be in [0,1], got ${r}` };
  }
  return 'pass';
};

const successIsBoolean: Invariant<AgentdbReflexionStorePayload> = ({ recordedPayload }) => {
  const s = recordedPayload.success;
  if (typeof s !== 'boolean') {
    return { violated: true, detail: `success must be a boolean, got ${typeof s}` };
  }
  return 'pass';
};

export const reflexionStoreInvariants: ReadonlyArray<Invariant<AgentdbReflexionStorePayload>> = [
  sessionIdWellFormed,
  sessionIdEquality,
  taskWellFormed,
  rewardInRange,
  successIsBoolean,
];
