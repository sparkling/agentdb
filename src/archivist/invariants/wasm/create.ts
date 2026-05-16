// charter: mutation-invariants
// wasm_agent_create mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler persists a `PersistedWasmAgent` snapshot; bad agent.id would
// produce an unaddressable record across processes.

import type { Invariant } from '../../registration.js';
import type { WasmAgentCreatePayload } from '../../handlers/wasm/create.js';

export type { WasmAgentCreatePayload };

const ID_MAX = 200;

/** agent must be a non-null object with a non-empty id. */
const agentWellFormed: Invariant<WasmAgentCreatePayload> = ({ recordedPayload }) => {
  const a = recordedPayload.agent;
  if (!a || typeof a !== 'object') {
    return { violated: true, detail: `agent must be an object, got ${typeof a}` };
  }
  if (typeof a.id !== 'string' || a.id.length === 0) {
    return { violated: true, detail: `agent.id must be a non-empty string, got ${typeof a.id}` };
  }
  if (a.id.length > ID_MAX) {
    return { violated: true, detail: `agent.id length ${a.id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** agent.id identity — TAUTOLOGY TODAY. */
const agentIdEquality: Invariant<WasmAgentCreatePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.agent?.id !== recordedPayload.agent?.id) {
    return { violated: true, detail: `agent.id divergence: intent='${String(callerIntent.agent?.id)}' recorded='${String(recordedPayload.agent?.id)}'` };
  }
  return 'pass';
};

export const createInvariants: ReadonlyArray<Invariant<WasmAgentCreatePayload>> = [
  agentWellFormed,
  agentIdEquality,
];
