// charter: mutation-invariants
// daa_agent_create mutation invariants (ADR-0181 §H).
// Creates a DAAAgent record under .claude-flow/daa/store.json. The agent id
// is the store key; malformed input lands an unaddressable record.

import type { Invariant } from '../../registration.js';
import type { DaaAgentCreatePayload } from '../../handlers/daa/agent-create.js';

export type { DaaAgentCreatePayload };

const ID_MAX = 500;
const NAME_MAX = 500;
const TYPE_MAX = 200;
const VALID_PATTERNS = new Set([
  'convergent',
  'divergent',
  'lateral',
  'systems',
  'critical',
  'adaptive',
]);

/** id must be a non-empty string ≤500 chars — used as the store key. */
const idWellFormed: Invariant<DaaAgentCreatePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.id;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `id must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `id length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** id identity — TAUTOLOGY today; ships as contract spec. */
const idEquality: Invariant<DaaAgentCreatePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.id !== recordedPayload.id) {
    return {
      violated: true,
      detail: `id divergence: intent='${callerIntent.id}' recorded='${recordedPayload.id}'`,
    };
  }
  return 'pass';
};

/** name (optional) must be a non-empty string ≤500 chars when present. */
const nameBoundedWhenPresent: Invariant<DaaAgentCreatePayload> = ({ recordedPayload }) => {
  const n = recordedPayload.name;
  if (n === undefined || n === null) return 'pass';
  if (typeof n !== 'string' || n.length === 0) {
    return { violated: true, detail: `name must be a non-empty string when present, got ${typeof n} length=${(n as string)?.length ?? 0}` };
  }
  if (n.length > NAME_MAX) {
    return { violated: true, detail: `name length ${n.length} exceeds max ${NAME_MAX}` };
  }
  return 'pass';
};

/** type (optional) must be a non-empty string ≤200 chars when present. */
const typeBoundedWhenPresent: Invariant<DaaAgentCreatePayload> = ({ recordedPayload }) => {
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

/** cognitivePattern (optional) must be one of the six DaaCognitivePattern
 *  variants when present. The handler defaults to 'adaptive'; an unknown
 *  recorded value indicates the typed enum was bypassed. */
const cognitivePatternInEnumWhenPresent: Invariant<DaaAgentCreatePayload> = ({ recordedPayload }) => {
  const p = recordedPayload.cognitivePattern;
  if (p === undefined || p === null) return 'pass';
  if (typeof p !== 'string' || !VALID_PATTERNS.has(p)) {
    return { violated: true, detail: `cognitivePattern must be one of {${[...VALID_PATTERNS].join(',')}}, got ${JSON.stringify(p)}` };
  }
  return 'pass';
};

/** learningRate (optional) must be finite ∈ [0, 1] when present. The DAA
 *  trainer uses this as a fraction; out-of-range values break SGD updates. */
const learningRateInRangeWhenPresent: Invariant<DaaAgentCreatePayload> = ({ recordedPayload }) => {
  const lr = recordedPayload.learningRate;
  if (lr === undefined || lr === null) return 'pass';
  if (typeof lr !== 'number' || !Number.isFinite(lr)) {
    return { violated: true, detail: `learningRate must be a finite number when present, got ${String(lr)}` };
  }
  if (lr < 0 || lr > 1) {
    return { violated: true, detail: `learningRate must be in [0,1], got ${lr}` };
  }
  return 'pass';
};

/** capabilities (optional) must be a string array when present. */
const capabilitiesWellFormedWhenPresent: Invariant<DaaAgentCreatePayload> = ({ recordedPayload }) => {
  const c = recordedPayload.capabilities;
  if (c === undefined || c === null) return 'pass';
  if (!Array.isArray(c)) {
    return { violated: true, detail: `capabilities must be an array when present, got ${typeof c}` };
  }
  for (const cap of c) {
    if (typeof cap !== 'string' || cap.length === 0) {
      return { violated: true, detail: `capabilities entries must be non-empty strings, got ${JSON.stringify(cap)}` };
    }
  }
  return 'pass';
};

export const agentCreateInvariants: ReadonlyArray<Invariant<DaaAgentCreatePayload>> = [
  idWellFormed,
  idEquality,
  nameBoundedWhenPresent,
  typeBoundedWhenPresent,
  cognitivePatternInEnumWhenPresent,
  learningRateInRangeWhenPresent,
  capabilitiesWellFormedWhenPresent,
];
