// charter: mutation-invariants
// agentdb_hierarchical_store mutation invariants (ADR-0181 §H).
// Writes (key, value, tier) into the hierarchical_memory SQLite table. The
// cli validates key ≤ 1KB, value ≤ 100KB and rejects unknown tier; these
// invariants re-check at the dispatch boundary.

import type { Invariant } from '../../registration.js';
import type { AgentdbHierarchicalStorePayload } from '../../handlers/agentdb/hierarchical-store.js';

export type { AgentdbHierarchicalStorePayload };

const KEY_MAX = 1_000;
const VALUE_MAX = 100_000;
const VALID_TIERS = new Set(['working', 'episodic', 'semantic']);

/** key must be a non-empty string ≤1KB. */
const keyWellFormed: Invariant<AgentdbHierarchicalStorePayload> = ({ recordedPayload }) => {
  const k = recordedPayload.key;
  if (typeof k !== 'string' || k.length === 0) {
    return { violated: true, detail: `key must be a non-empty string, got ${typeof k} length=${(k as string)?.length ?? 0}` };
  }
  if (k.length > KEY_MAX) {
    return { violated: true, detail: `key length ${k.length} exceeds max ${KEY_MAX}` };
  }
  return 'pass';
};

/** key identity — TAUTOLOGY today; ships as contract spec. */
const keyEquality: Invariant<AgentdbHierarchicalStorePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.key !== recordedPayload.key) {
    return {
      violated: true,
      detail: `key divergence: intent='${callerIntent.key}' recorded='${recordedPayload.key}'`,
    };
  }
  return 'pass';
};

/** value must be a non-empty string ≤100KB. */
const valueWellFormed: Invariant<AgentdbHierarchicalStorePayload> = ({ recordedPayload }) => {
  const v = recordedPayload.value;
  if (typeof v !== 'string' || v.length === 0) {
    return { violated: true, detail: `value must be a non-empty string, got ${typeof v} length=${(v as string)?.length ?? 0}` };
  }
  if (v.length > VALUE_MAX) {
    return { violated: true, detail: `value length ${v.length} exceeds max ${VALUE_MAX}` };
  }
  return 'pass';
};

/** value identity — TAUTOLOGY today; ships as contract spec. */
const valueEquality: Invariant<AgentdbHierarchicalStorePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.value !== recordedPayload.value) {
    return {
      violated: true,
      detail: `value divergence: intent.length=${callerIntent.value?.length ?? 0} recorded.length=${recordedPayload.value?.length ?? 0}`,
    };
  }
  return 'pass';
};

/** tier (optional) must be one of {working, episodic, semantic} when present. */
const tierInEnumWhenPresent: Invariant<AgentdbHierarchicalStorePayload> = ({ recordedPayload }) => {
  const t = recordedPayload.tier;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'string' || !VALID_TIERS.has(t)) {
    return { violated: true, detail: `tier must be one of {working,episodic,semantic}, got ${JSON.stringify(t)}` };
  }
  return 'pass';
};

export const hierarchicalStoreInvariants: ReadonlyArray<Invariant<AgentdbHierarchicalStorePayload>> = [
  keyWellFormed,
  keyEquality,
  valueWellFormed,
  valueEquality,
  tierInEnumWhenPresent,
];
