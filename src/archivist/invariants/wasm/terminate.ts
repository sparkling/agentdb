// charter: mutation-invariants
// wasm_agent_terminate mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// Termination is the most destructive WASM agent transition — guard the id.

import type { Invariant } from '../../registration.js';
import type { WasmAgentTerminatePayload } from '../../handlers/wasm/terminate.js';

export type { WasmAgentTerminatePayload };

const ID_MAX = 200;

const agentIdWellFormed: Invariant<WasmAgentTerminatePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.agentId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `agentId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `agentId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

const agentIdEquality: Invariant<WasmAgentTerminatePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.agentId !== recordedPayload.agentId) {
    return { violated: true, detail: `agentId divergence: intent='${callerIntent.agentId}' recorded='${recordedPayload.agentId}'` };
  }
  return 'pass';
};

export const terminateInvariants: ReadonlyArray<Invariant<WasmAgentTerminatePayload>> = [
  agentIdWellFormed,
  agentIdEquality,
];
