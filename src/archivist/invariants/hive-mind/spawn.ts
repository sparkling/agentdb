// charter: mutation-invariants
// hive-mind_spawn mutation invariants (ADR-0181 §H).
// Cross-store mutation (hive-state + agents.json). The handler validates
// agentType/agentTypes mutex + retryOf required for retryTask; these
// invariants guard range/well-formedness at the dispatch boundary.

import type { Invariant } from '../../registration.js';
import type { HiveMindSpawnPayload } from '../../handlers/hive-mind/spawn.js';

export type { HiveMindSpawnPayload };

const VALID_ACTIONS = new Set(['spawn', 'retryTask']);
const VALID_ROLES = new Set(['worker', 'specialist', 'scout']);
const COUNT_MAX = 20;
const PREFIX_MAX = 500;
const RETRY_OF_MAX = 500;

/** action (optional) must be one of {spawn, retryTask} when present. */
const actionInEnumWhenPresent: Invariant<HiveMindSpawnPayload> = ({ recordedPayload }) => {
  const a = recordedPayload.action;
  if (a === undefined || a === null) return 'pass';
  if (typeof a !== 'string' || !VALID_ACTIONS.has(a)) {
    return { violated: true, detail: `action must be one of {spawn,retryTask}, got ${JSON.stringify(a)}` };
  }
  return 'pass';
};

/** count (optional) must be a finite integer ∈ [1, 20] when present (handler
 *  clamps to this range; invariant guards a NaN/negative leaking through). */
const countInRangeWhenPresent: Invariant<HiveMindSpawnPayload> = ({ recordedPayload }) => {
  const c = recordedPayload.count;
  if (c === undefined || c === null) return 'pass';
  if (typeof c !== 'number' || !Number.isFinite(c) || !Number.isInteger(c)) {
    return { violated: true, detail: `count must be a finite integer when present, got ${String(c)}` };
  }
  if (c < 1 || c > COUNT_MAX) {
    return { violated: true, detail: `count must be in [1,${COUNT_MAX}], got ${c}` };
  }
  return 'pass';
};

/** role (optional) must be one of {worker, specialist, scout} when present. */
const roleInEnumWhenPresent: Invariant<HiveMindSpawnPayload> = ({ recordedPayload }) => {
  const r = recordedPayload.role;
  if (r === undefined || r === null) return 'pass';
  if (typeof r !== 'string' || !VALID_ROLES.has(r)) {
    return { violated: true, detail: `role must be one of {worker,specialist,scout}, got ${JSON.stringify(r)}` };
  }
  return 'pass';
};

/** prefix (optional) must be a non-empty string ≤500 chars when present. */
const prefixBoundedWhenPresent: Invariant<HiveMindSpawnPayload> = ({ recordedPayload }) => {
  const p = recordedPayload.prefix;
  if (p === undefined || p === null) return 'pass';
  if (typeof p !== 'string' || p.length === 0) {
    return { violated: true, detail: `prefix must be a non-empty string when present, got ${typeof p} length=${(p as string)?.length ?? 0}` };
  }
  if (p.length > PREFIX_MAX) {
    return { violated: true, detail: `prefix length ${p.length} exceeds max ${PREFIX_MAX}` };
  }
  return 'pass';
};

/** retryOf (required iff action='retryTask') must be a non-empty string ≤500 chars
 *  when present. The handler already throws on missing for retryTask; this
 *  guards range and string-shape. */
const retryOfWellFormedWhenPresent: Invariant<HiveMindSpawnPayload> = ({ recordedPayload }) => {
  const r = recordedPayload.retryOf;
  if (r === undefined || r === null || r === '') return 'pass';
  if (typeof r !== 'string') {
    return { violated: true, detail: `retryOf must be a string when present, got ${typeof r}` };
  }
  if (r.length > RETRY_OF_MAX) {
    return { violated: true, detail: `retryOf length ${r.length} exceeds max ${RETRY_OF_MAX}` };
  }
  return 'pass';
};

/** agentTypes (optional) must be a string array when present. */
const agentTypesWellFormedWhenPresent: Invariant<HiveMindSpawnPayload> = ({ recordedPayload }) => {
  const at = recordedPayload.agentTypes;
  if (at === undefined || at === null) return 'pass';
  if (!Array.isArray(at)) {
    return { violated: true, detail: `agentTypes must be an array when present, got ${typeof at}` };
  }
  for (const t of at) {
    if (typeof t !== 'string' || t.length === 0) {
      return { violated: true, detail: `agentTypes entries must be non-empty strings, got ${JSON.stringify(t)}` };
    }
  }
  return 'pass';
};

export const spawnInvariants: ReadonlyArray<Invariant<HiveMindSpawnPayload>> = [
  actionInEnumWhenPresent,
  countInRangeWhenPresent,
  roleInEnumWhenPresent,
  prefixBoundedWhenPresent,
  retryOfWellFormedWhenPresent,
  agentTypesWellFormedWhenPresent,
];
