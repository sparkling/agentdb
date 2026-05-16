// charter: mutation-invariants
// agent_terminate mutation invariants (ADR-0181 §H).
// Termination flips `agents[agentId].status='terminated'`; an empty/wrong
// agentId silently terminates nothing (the handler throws on missing-agent,
// but a typo'd id reaching the wrong record IS substrate corruption).

import type { Invariant } from '../../registration.js';
import type { AgentTerminatePayload } from '../../handlers/agents/terminate.js';

export type { AgentTerminatePayload };

const AGENT_ID_MAX = 500;

/** agentId must be a non-empty string ≤500 chars. */
const agentIdWellFormed: Invariant<AgentTerminatePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.agentId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `agentId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > AGENT_ID_MAX) {
    return { violated: true, detail: `agentId length ${id.length} exceeds max ${AGENT_ID_MAX}` };
  }
  return 'pass';
};

/** agentId identity — substrate routes per agentId; divergence terminates the
 *  wrong record. TAUTOLOGY today (single dispatch payload); ships as contract spec. */
const agentIdEquality: Invariant<AgentTerminatePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.agentId !== recordedPayload.agentId) {
    return {
      violated: true,
      detail: `agentId divergence: intent='${callerIntent.agentId}' recorded='${recordedPayload.agentId}'`,
    };
  }
  return 'pass';
};

export const terminateInvariants: ReadonlyArray<Invariant<AgentTerminatePayload>> = [
  agentIdWellFormed,
  agentIdEquality,
];
