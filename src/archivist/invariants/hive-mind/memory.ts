// charter: mutation-invariants
// hive-mind_memory mutation invariants (ADR-0181 §H).
// Discriminated payload with four actions (get/set/delete/list). Get/set/
// delete require a non-empty key; set requires a type ∈ HIVE_MEMORY_TYPES.
// The handler validates these too; invariants ship as the dispatch-boundary
// contract so a non-cli caller can't bypass.

import type { Invariant } from '../../registration.js';
import type { HiveMindMemoryPayload } from '../../handlers/hive-mind/memory.js';

export type { HiveMindMemoryPayload };

const VALID_ACTIONS = new Set(['get', 'set', 'delete', 'list']);
const VALID_TYPES = new Set([
  'knowledge', 'context', 'task', 'result', 'error', 'metric', 'consensus', 'system',
]);
const KEY_MAX = 1_000;

const actionInEnum: Invariant<HiveMindMemoryPayload> = ({ recordedPayload }) => {
  const a = recordedPayload?.action;
  if (typeof a !== 'string' || !VALID_ACTIONS.has(a)) {
    return { violated: true, detail: `action must be one of {get,set,delete,list}, got ${JSON.stringify(a)}` };
  }
  return 'pass';
};

/** action identity — TAUTOLOGY today; ships as contract spec. */
const actionEquality: Invariant<HiveMindMemoryPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent?.action !== recordedPayload?.action) {
    return {
      violated: true,
      detail: `action divergence: intent='${callerIntent?.action}' recorded='${recordedPayload?.action}'`,
    };
  }
  return 'pass';
};

/** For get/set/delete: key must be non-empty ≤1KB. For list: no key check. */
const keyWellFormedForKeyedActions: Invariant<HiveMindMemoryPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action === 'list') return 'pass';
  const k = recordedPayload.key;
  if (typeof k !== 'string' || k.length === 0) {
    return { violated: true, detail: `key must be a non-empty string for action='${recordedPayload.action}', got ${typeof k} length=${(k as string)?.length ?? 0}` };
  }
  if (k.length > KEY_MAX) {
    return { violated: true, detail: `key length ${k.length} exceeds max ${KEY_MAX}` };
  }
  return 'pass';
};

/** set.type must be a HiveMemoryType. */
const setTypeInEnum: Invariant<HiveMindMemoryPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'set') return 'pass';
  const t = recordedPayload.type;
  if (typeof t !== 'string' || !VALID_TYPES.has(t)) {
    return { violated: true, detail: `set.type must be a HiveMemoryType, got ${JSON.stringify(t)}` };
  }
  return 'pass';
};

/** set.ttlMs must be a finite non-negative number or null when present. */
const setTtlNonNegativeWhenPresent: Invariant<HiveMindMemoryPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'set') return 'pass';
  const t = recordedPayload.ttlMs;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    return { violated: true, detail: `set.ttlMs must be a finite number or null, got ${String(t)}` };
  }
  if (t < 0) {
    return { violated: true, detail: `set.ttlMs must be >= 0, got ${t}` };
  }
  return 'pass';
};

/** list.type (filter) when present must be a HiveMemoryType. */
const listTypeInEnumWhenPresent: Invariant<HiveMindMemoryPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'list') return 'pass';
  const t = recordedPayload.type;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'string' || !VALID_TYPES.has(t)) {
    return { violated: true, detail: `list.type filter must be a HiveMemoryType, got ${JSON.stringify(t)}` };
  }
  return 'pass';
};

export const memoryInvariants: ReadonlyArray<Invariant<HiveMindMemoryPayload>> = [
  actionInEnum,
  actionEquality,
  keyWellFormedForKeyedActions,
  setTypeInEnum,
  setTtlNonNegativeWhenPresent,
  listTypeInEnumWhenPresent,
];
