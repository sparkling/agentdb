// charter: mutation-invariants
// agentdb_sona_trajectory_store mutation invariants (ADR-0181 §H).
// Only the 'record' action reaches the mutation handler; 'stats' is read.
// Pattern is required on 'record'; agentType/type are info, reward bounded.

import type { Invariant } from '../../registration.js';
import type { AgentdbSonaTrajectoryStorePayload } from '../../handlers/agentdb/sona-trajectory-store.js';

export type { AgentdbSonaTrajectoryStorePayload };

const PATTERN_MAX = 10_000;
const AGENT_TYPE_MAX = 200;
const TYPE_MAX = 200;

/** action defaults to 'record' on mutation path; reject 'stats' (must go
 *  through dispatchRead). */
const actionIsRecord: Invariant<AgentdbSonaTrajectoryStorePayload> = ({ recordedPayload }) => {
  const a = recordedPayload.action;
  if (a !== undefined && a !== 'record') {
    return { violated: true, detail: `action must be 'record' on mutation path (got ${JSON.stringify(a)} — 'stats' is read-side)` };
  }
  return 'pass';
};

/** pattern required and non-empty ≤10KB on record. */
const patternWellFormed: Invariant<AgentdbSonaTrajectoryStorePayload> = ({ recordedPayload }) => {
  const p = recordedPayload.pattern;
  if (typeof p !== 'string' || p.length === 0) {
    return { violated: true, detail: `pattern is required for action='record' and must be a non-empty string, got ${typeof p} length=${(p as string)?.length ?? 0}` };
  }
  if (p.length > PATTERN_MAX) {
    return { violated: true, detail: `pattern length ${p.length} exceeds max ${PATTERN_MAX}` };
  }
  return 'pass';
};

/** pattern identity — TAUTOLOGY today; ships as contract spec. */
const patternEquality: Invariant<AgentdbSonaTrajectoryStorePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.pattern !== recordedPayload.pattern) {
    return {
      violated: true,
      detail: `pattern divergence: intent.length=${callerIntent.pattern?.length ?? 0} recorded.length=${recordedPayload.pattern?.length ?? 0}`,
    };
  }
  return 'pass';
};

const agentTypeBoundedWhenPresent: Invariant<AgentdbSonaTrajectoryStorePayload> = ({ recordedPayload }) => {
  const a = recordedPayload.agentType;
  if (a === undefined || a === null) return 'pass';
  if (typeof a !== 'string' || a.length === 0) {
    return { violated: true, detail: `agentType must be a non-empty string when present, got ${typeof a} length=${(a as string)?.length ?? 0}` };
  }
  if (a.length > AGENT_TYPE_MAX) {
    return { violated: true, detail: `agentType length ${a.length} exceeds max ${AGENT_TYPE_MAX}` };
  }
  return 'pass';
};

const typeBoundedWhenPresent: Invariant<AgentdbSonaTrajectoryStorePayload> = ({ recordedPayload }) => {
  const t = recordedPayload.type;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `type must be a non-empty string when present, got ${typeof t} length=${(t as string)?.length ?? 0}` };
  }
  if (t.length > TYPE_MAX) {
    return { violated: true, detail: `type length ${t.length} exceeds max ${TYPE_MAX}` };
  }
  return 'pass';
};

/** reward (optional, alias=confidence) must be finite ∈ [0, 1] when present. */
const rewardInRangeWhenPresent: Invariant<AgentdbSonaTrajectoryStorePayload> = ({ recordedPayload }) => {
  const r = recordedPayload.reward ?? recordedPayload.confidence;
  if (r === undefined || r === null) return 'pass';
  if (typeof r !== 'number' || !Number.isFinite(r)) {
    return { violated: true, detail: `reward (or confidence alias) must be a finite number when present, got ${String(r)}` };
  }
  if (r < 0 || r > 1) {
    return { violated: true, detail: `reward must be in [0,1], got ${r}` };
  }
  return 'pass';
};

export const sonaTrajectoryStoreInvariants: ReadonlyArray<Invariant<AgentdbSonaTrajectoryStorePayload>> = [
  actionIsRecord,
  patternWellFormed,
  patternEquality,
  agentTypeBoundedWhenPresent,
  typeBoundedWhenPresent,
  rewardInRangeWhenPresent,
];
