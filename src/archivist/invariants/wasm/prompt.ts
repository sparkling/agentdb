// charter: mutation-invariants
// wasm_agent_prompt mutation invariants — same persistence shape as wasm_agent_create.

import type { Invariant } from '../../registration.js';
import type { WasmAgentPromptPayload } from '../../handlers/wasm/prompt.js';

export type { WasmAgentPromptPayload };

const ID_MAX = 200;

const agentWellFormed: Invariant<WasmAgentPromptPayload> = ({ recordedPayload }) => {
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

const agentIdEquality: Invariant<WasmAgentPromptPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.agent?.id !== recordedPayload.agent?.id) {
    return { violated: true, detail: `agent.id divergence: intent='${String(callerIntent.agent?.id)}' recorded='${String(recordedPayload.agent?.id)}'` };
  }
  return 'pass';
};

export const promptInvariants: ReadonlyArray<Invariant<WasmAgentPromptPayload>> = [
  agentWellFormed,
  agentIdEquality,
];
