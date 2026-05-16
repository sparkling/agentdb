// charter: mutation-invariants
// swarm_init mutation invariants (ADR-0181 §H).
// Validates the SwarmInitPayload at the dispatch boundary so a non-cli caller
// can't slip an invalid topology / out-of-range maxAgents through (the handler
// clamps maxAgents and throws on invalid topology, but invariants ship as
// the contract spec).

import type { Invariant } from '../../registration.js';
import type { SwarmInitPayload } from '../../handlers/swarm/init.js';

export type { SwarmInitPayload };

const VALID_TOPOLOGIES = new Set([
  'hierarchical',
  'mesh',
  'hierarchical-mesh',
  'ring',
  'star',
  'hybrid',
  'adaptive',
]);
const VALID_STRATEGIES = new Set(['specialized', 'balanced', 'adaptive']);
const REASON_MAX = 2_000;
const MAX_AGENTS_HARD_MAX = 1_000; // wider than the handler's clamp([1,50]) — invariant rejects only nonsense

/** topology (optional) must be one of the seven variants when present. */
const topologyInEnumWhenPresent: Invariant<SwarmInitPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.topology;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'string' || !VALID_TOPOLOGIES.has(t)) {
    return { violated: true, detail: `topology must be one of {${[...VALID_TOPOLOGIES].join(',')}}, got ${JSON.stringify(t)}` };
  }
  return 'pass';
};

/** topology identity — TAUTOLOGY today; ships as contract spec. */
const topologyEquality: Invariant<SwarmInitPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.topology !== recordedPayload.topology) {
    return {
      violated: true,
      detail: `topology divergence: intent='${callerIntent.topology}' recorded='${recordedPayload.topology}'`,
    };
  }
  return 'pass';
};

/** maxAgents (optional) must be a finite positive integer when present. */
const maxAgentsBoundedWhenPresent: Invariant<SwarmInitPayload> = ({ recordedPayload }) => {
  const m = recordedPayload.maxAgents;
  if (m === undefined || m === null) return 'pass';
  if (typeof m !== 'number' || !Number.isFinite(m) || !Number.isInteger(m)) {
    return { violated: true, detail: `maxAgents must be a finite integer when present, got ${String(m)}` };
  }
  if (m < 1 || m > MAX_AGENTS_HARD_MAX) {
    return { violated: true, detail: `maxAgents must be in [1,${MAX_AGENTS_HARD_MAX}], got ${m}` };
  }
  return 'pass';
};

/** strategy (optional) must be one of {specialized, balanced, adaptive}. */
const strategyInEnumWhenPresent: Invariant<SwarmInitPayload> = ({ recordedPayload }) => {
  const s = recordedPayload.strategy;
  if (s === undefined || s === null) return 'pass';
  if (typeof s !== 'string' || !VALID_STRATEGIES.has(s)) {
    return { violated: true, detail: `strategy must be one of {specialized,balanced,adaptive}, got ${JSON.stringify(s)}` };
  }
  return 'pass';
};

/** force (optional) must be a boolean when present. */
const forceBooleanWhenPresent: Invariant<SwarmInitPayload> = ({ recordedPayload }) => {
  const f = recordedPayload.force;
  if (f === undefined || f === null) return 'pass';
  if (typeof f !== 'boolean') {
    return { violated: true, detail: `force must be a boolean when present, got ${typeof f}` };
  }
  return 'pass';
};

/** reason (optional) must be a string ≤2000 chars when present. */
const reasonBoundedWhenPresent: Invariant<SwarmInitPayload> = ({ recordedPayload }) => {
  const r = recordedPayload.reason;
  if (r === undefined || r === null) return 'pass';
  if (typeof r !== 'string') {
    return { violated: true, detail: `reason must be a string when present, got ${typeof r}` };
  }
  if (r.length > REASON_MAX) {
    return { violated: true, detail: `reason length ${r.length} exceeds max ${REASON_MAX}` };
  }
  return 'pass';
};

export const initInvariants: ReadonlyArray<Invariant<SwarmInitPayload>> = [
  topologyInEnumWhenPresent,
  topologyEquality,
  maxAgentsBoundedWhenPresent,
  strategyInEnumWhenPresent,
  forceBooleanWhenPresent,
  reasonBoundedWhenPresent,
];
