// charter: mutation-invariants
// agent_spawn mutation invariants (ADR-0181 §H).
// Spawn writes a brand-new AgentRecord into `.claude-flow/agents/store.json`;
// a malformed record corrupts every downstream agent_* handler that reads
// `store.agents[agentId]` (execute, terminate, update, pool). These invariants
// guard the on-disk shape at the dispatch boundary so a non-cli caller can't
// land an unaddressable / out-of-enum / non-finite record.

import type { Invariant } from '../../registration.js';
import type { AgentSpawnPayload } from '../../handlers/agents/spawn.js';

export type { AgentSpawnPayload };

const VALID_STATUSES = new Set(['idle', 'busy', 'terminated']);

/** agentId must be a non-empty string. The store keys agents by `agent.agentId`;
 *  an empty id collapses entries on top of each other and breaks lookup. */
const agentIdNonEmpty: Invariant<AgentSpawnPayload> = ({ recordedPayload }) => {
  const id = recordedPayload.agent?.agentId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `agent.agentId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  return 'pass';
};

/** agentId identity — substrate keys per `agent.agentId`; divergence is a
 *  data-placement bug (TAUTOLOGY today: dispatch passes the same payload
 *  object as both callerIntent and recordedPayload — ships as contract
 *  spec for when dispatch evolves to a true intent-vs-recorded boundary). */
const agentIdEquality: Invariant<AgentSpawnPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.agent?.agentId !== recordedPayload.agent?.agentId) {
    return {
      violated: true,
      detail: `agent.agentId divergence: intent='${callerIntent.agent?.agentId}' recorded='${recordedPayload.agent?.agentId}'`,
    };
  }
  return 'pass';
};

/** agentType must be a non-empty string. agent_pool filters/scales by type;
 *  an empty type silently widens the filter. */
const agentTypeNonEmpty: Invariant<AgentSpawnPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.agent?.agentType;
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `agent.agentType must be a non-empty string, got ${typeof t} length=${(t as string)?.length ?? 0}` };
  }
  return 'pass';
};

/** status must be one of {idle, busy, terminated}. The downstream agent_pool
 *  / agent_update / agent_execute branches narrow on this union; an unknown
 *  value bypasses every status-keyed selector. */
const statusInEnum: Invariant<AgentSpawnPayload> = ({ recordedPayload }) => {
  const s = recordedPayload.agent?.status;
  if (typeof s !== 'string' || !VALID_STATUSES.has(s)) {
    return { violated: true, detail: `agent.status must be one of {idle,busy,terminated}, got ${JSON.stringify(s)}` };
  }
  return 'pass';
};

/** health must be a finite number in [0,1]. The pool-scaling math assumes a
 *  normalized fraction; NaN/±Infinity poisons every aggregate. */
const healthInRange: Invariant<AgentSpawnPayload> = ({ recordedPayload }) => {
  const h = recordedPayload.agent?.health;
  if (typeof h !== 'number' || !Number.isFinite(h)) {
    return { violated: true, detail: `agent.health must be a finite number, got ${String(h)}` };
  }
  if (h < 0 || h > 1) {
    return { violated: true, detail: `agent.health must be in [0,1], got ${h}` };
  }
  return 'pass';
};

/** taskCount must be a finite non-negative integer. The execute handler
 *  increments this; a negative seed produces nonsensical task-load math. */
const taskCountNonNegative: Invariant<AgentSpawnPayload> = ({ recordedPayload }) => {
  const c = recordedPayload.agent?.taskCount;
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || !Number.isInteger(c)) {
    return { violated: true, detail: `agent.taskCount must be a non-negative integer, got ${String(c)}` };
  }
  return 'pass';
};

export const spawnInvariants: ReadonlyArray<Invariant<AgentSpawnPayload>> = [
  agentIdNonEmpty,
  agentIdEquality,
  agentTypeNonEmpty,
  statusInEnum,
  healthInRange,
  taskCountNonNegative,
];
