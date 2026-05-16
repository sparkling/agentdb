// charter: mutation-invariants
// hive-mind_agents mutation invariants (ADR-0181 §H).
// Discriminated payload with three actions (spawn/remove/clear). Per-action
// guards: spawn requires a well-formed AgentRecord, remove requires a
// non-empty agentId, clear requires a string array.

import type { Invariant } from '../../registration.js';
import type { AgentsJsonPayload } from '../../handlers/hive-mind/agents-json.js';

export type { AgentsJsonPayload };

const VALID_ACTIONS = new Set(['spawn', 'remove', 'clear']);
const VALID_STATUSES = new Set(['idle', 'busy', 'errored']);
const AGENT_ID_MAX = 500;

/** action must be one of {spawn, remove, clear}. */
const actionInEnum: Invariant<AgentsJsonPayload> = ({ recordedPayload }) => {
  const a = recordedPayload?.action;
  if (typeof a !== 'string' || !VALID_ACTIONS.has(a)) {
    return { violated: true, detail: `action must be one of {spawn,remove,clear}, got ${JSON.stringify(a)}` };
  }
  return 'pass';
};

/** action identity — TAUTOLOGY today; ships as contract spec. */
const actionEquality: Invariant<AgentsJsonPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent?.action !== recordedPayload?.action) {
    return {
      violated: true,
      detail: `action divergence: intent='${callerIntent?.action}' recorded='${recordedPayload?.action}'`,
    };
  }
  return 'pass';
};

/** Per-action shape guards. */
const perActionShape: Invariant<AgentsJsonPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action === 'spawn') {
    const agent = recordedPayload.agent;
    if (!agent || typeof agent !== 'object') {
      return { violated: true, detail: `spawn requires an agent object, got ${typeof agent}` };
    }
    if (typeof agent.agentId !== 'string' || agent.agentId.length === 0) {
      return { violated: true, detail: `spawn.agent.agentId must be a non-empty string` };
    }
    if (agent.agentId.length > AGENT_ID_MAX) {
      return { violated: true, detail: `spawn.agent.agentId length ${agent.agentId.length} exceeds max ${AGENT_ID_MAX}` };
    }
    if (typeof agent.agentType !== 'string' || agent.agentType.length === 0) {
      return { violated: true, detail: `spawn.agent.agentType must be a non-empty string` };
    }
    if (typeof agent.status !== 'string' || !VALID_STATUSES.has(agent.status)) {
      return { violated: true, detail: `spawn.agent.status must be one of {idle,busy,errored}, got ${JSON.stringify(agent.status)}` };
    }
    if (typeof agent.health !== 'number' || !Number.isFinite(agent.health) || agent.health < 0 || agent.health > 1) {
      return { violated: true, detail: `spawn.agent.health must be a finite number in [0,1], got ${String(agent.health)}` };
    }
    return 'pass';
  }
  if (recordedPayload.action === 'remove') {
    const id = recordedPayload.agentId;
    if (typeof id !== 'string' || id.length === 0) {
      return { violated: true, detail: `remove.agentId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
    }
    return 'pass';
  }
  if (recordedPayload.action === 'clear') {
    const ids = recordedPayload.agentIds;
    if (!Array.isArray(ids)) {
      return { violated: true, detail: `clear.agentIds must be an array, got ${typeof ids}` };
    }
    for (const id of ids) {
      if (typeof id !== 'string' || id.length === 0) {
        return { violated: true, detail: `clear.agentIds entries must be non-empty strings, got ${JSON.stringify(id)}` };
      }
    }
    return 'pass';
  }
  return 'pass';
};

export const agentsJsonInvariants: ReadonlyArray<Invariant<AgentsJsonPayload>> = [
  actionInEnum,
  actionEquality,
  perActionShape,
];
