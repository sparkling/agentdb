// charter: mutation-invariants
// wasm_gallery_create mutation invariants — same shape as wasm_agent_create.

import type { Invariant } from '../../registration.js';
import type { WasmGalleryCreatePayload } from '../../handlers/wasm/gallery-create.js';

export type { WasmGalleryCreatePayload };

const ID_MAX = 200;

const agentWellFormed: Invariant<WasmGalleryCreatePayload> = ({ recordedPayload }) => {
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

const agentIdEquality: Invariant<WasmGalleryCreatePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.agent?.id !== recordedPayload.agent?.id) {
    return { violated: true, detail: `agent.id divergence: intent='${String(callerIntent.agent?.id)}' recorded='${String(recordedPayload.agent?.id)}'` };
  }
  return 'pass';
};

export const galleryCreateInvariants: ReadonlyArray<Invariant<WasmGalleryCreatePayload>> = [
  agentWellFormed,
  agentIdEquality,
];
