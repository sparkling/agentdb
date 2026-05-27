// charter: mutation-invariants
// agentdb_graph_edge mutation invariants (ADR-0261 §R2.6 acceptance criteria).
//
// Action-discriminated payload: each invariant runs on every action's
// recordedPayload — those that don't apply to a specific action return 'pass'
// (e.g. embedding-dim check only fires on 'save' AND only when an embedding
// was supplied). The set as a whole enforces:
//   - relation non-empty (save)
//   - sourceId / targetId non-empty strings (save) — domain-prefixed UUIDs
//     per upstream's convention (e.g. 'task:abc', 'pattern:xyz')
//   - confidence / weight / decay_rate finite non-negative (save, reinforce)
//   - encoded payload bytes equal `16 + configuredDim` when embedding present (save)
//   - maxAgeDays positive finite (sweep-internal)

import type { Invariant } from '../../registration.js';
import type { AgentdbGraphEdgePayload } from '../../handlers/agentdb/graph-edge.js';
import { payloadBytesForCurrentConfig } from '../../../encoders/scalar-int8-encoder.js';

export type { AgentdbGraphEdgePayload };

const RELATION_MAX = 200;
const ID_MAX = 256;

/** relation non-empty + ≤200 chars (save only). */
const relationWellFormed: Invariant<AgentdbGraphEdgePayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'save') return 'pass';
  const r = recordedPayload.relation;
  if (typeof r !== 'string' || r.length === 0) {
    return {
      violated: true,
      detail: `relation must be a non-empty string, got ${typeof r} length=${(r as string)?.length ?? 0}`,
    };
  }
  if (r.length > RELATION_MAX) {
    return { violated: true, detail: `relation length ${r.length} exceeds max ${RELATION_MAX}` };
  }
  return 'pass';
};

function isNonEmptyString(v: unknown, max: number): boolean {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

/** source/target ids must be non-empty strings (save) — upstream convention. */
const memoryIdsWellFormed: Invariant<AgentdbGraphEdgePayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'save') return 'pass';
  if (!isNonEmptyString(recordedPayload.sourceId, ID_MAX)) {
    return {
      violated: true,
      detail: `sourceId must be a non-empty string ≤${ID_MAX} chars, got ${String(recordedPayload.sourceId)}`,
    };
  }
  if (!isNonEmptyString(recordedPayload.targetId, ID_MAX)) {
    return {
      violated: true,
      detail: `targetId must be a non-empty string ≤${ID_MAX} chars, got ${String(recordedPayload.targetId)}`,
    };
  }
  return 'pass';
};

function finiteNonNeg(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** confidence (save / reinforce) must be finite ∈ [0, 1] when present. */
const confidenceInRange: Invariant<AgentdbGraphEdgePayload> = ({ recordedPayload }) => {
  if (recordedPayload.action === 'save' || recordedPayload.action === 'reinforce') {
    const c = recordedPayload.confidence;
    if (c === undefined) return 'pass';
    if (!Number.isFinite(c)) {
      return { violated: true, detail: `confidence must be finite, got ${String(c)}` };
    }
    if (c < 0 || c > 1) {
      return { violated: true, detail: `confidence must be in [0,1], got ${c}` };
    }
  }
  return 'pass';
};

/** weight (save) must be finite non-negative when present. */
const weightFiniteNonNeg: Invariant<AgentdbGraphEdgePayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'save') return 'pass';
  if (recordedPayload.weight === undefined) return 'pass';
  if (!finiteNonNeg(recordedPayload.weight)) {
    return {
      violated: true,
      detail: `weight must be a finite non-negative number, got ${String(recordedPayload.weight)}`,
    };
  }
  return 'pass';
};

/** decay_rate (save) must be finite non-negative when present. */
const decayRateFiniteNonNeg: Invariant<AgentdbGraphEdgePayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'save') return 'pass';
  if (recordedPayload.decayRate === undefined) return 'pass';
  if (!finiteNonNeg(recordedPayload.decayRate)) {
    return {
      violated: true,
      detail: `decayRate must be a finite non-negative number, got ${String(recordedPayload.decayRate)}`,
    };
  }
  return 'pass';
};

/**
 * Embedding length must match config-chain's configured dim (save), but ONLY
 * when an embedding is actually supplied. Producers that omit the embedding
 * (Agent B's hooks-tools.ts callers today) are allowed — the encoder's dim
 * check fires only on the encode path.
 */
const embeddingDimMatchesConfig: Invariant<AgentdbGraphEdgePayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'save') return 'pass';
  if (recordedPayload.embedding === undefined) return 'pass';
  const expectedBytes = payloadBytesForCurrentConfig();
  const expectedDim = expectedBytes - 16; // header is 16B
  const e = recordedPayload.embedding;
  if (!(e instanceof Float32Array)) {
    return {
      violated: true,
      detail: `embedding must be a Float32Array, got ${typeof e}`,
    };
  }
  if (e.length !== expectedDim) {
    return {
      violated: true,
      detail: `embedding length ${e.length} does not match configured dim ${expectedDim}`,
    };
  }
  return 'pass';
};

/** maxAgeDays must be a positive finite number (sweep-internal). */
const sweepMaxAgeDaysPositive: Invariant<AgentdbGraphEdgePayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'sweep-internal') return 'pass';
  if (!Number.isFinite(recordedPayload.maxAgeDays) || recordedPayload.maxAgeDays <= 0) {
    return {
      violated: true,
      detail: `maxAgeDays must be a positive finite number, got ${String(recordedPayload.maxAgeDays)}`,
    };
  }
  return 'pass';
};

function isPositiveInt(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

/** id must be a positive integer (load / reinforce). `id` is the auto-increment PK. */
const idPositiveWhenRequired: Invariant<AgentdbGraphEdgePayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'load' && recordedPayload.action !== 'reinforce') return 'pass';
  if (!isPositiveInt(recordedPayload.id)) {
    return {
      violated: true,
      detail: `id must be a positive integer, got ${String(recordedPayload.id)}`,
    };
  }
  return 'pass';
};

/** query/decay memoryId (when present) must be a non-empty string. */
const queryMemoryIdWellFormedWhenPresent: Invariant<AgentdbGraphEdgePayload> = ({ recordedPayload }) => {
  if (recordedPayload.action === 'query') {
    if (!isNonEmptyString(recordedPayload.memoryId, ID_MAX)) {
      return {
        violated: true,
        detail: `query.memoryId must be a non-empty string ≤${ID_MAX} chars, got ${String(recordedPayload.memoryId)}`,
      };
    }
  }
  if (recordedPayload.action === 'decay') {
    if (recordedPayload.memoryId !== undefined && !isNonEmptyString(recordedPayload.memoryId, ID_MAX)) {
      return {
        violated: true,
        detail: `decay.memoryId must be a non-empty string when present, got ${String(recordedPayload.memoryId)}`,
      };
    }
  }
  return 'pass';
};

export const graphEdgeInvariants: ReadonlyArray<Invariant<AgentdbGraphEdgePayload>> = [
  relationWellFormed,
  memoryIdsWellFormed,
  confidenceInRange,
  weightFiniteNonNeg,
  decayRateFiniteNonNeg,
  embeddingDimMatchesConfig,
  sweepMaxAgeDaysPositive,
  idPositiveWhenRequired,
  queryMemoryIdWellFormedWhenPresent,
];
