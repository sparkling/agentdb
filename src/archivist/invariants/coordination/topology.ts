// charter: mutation-invariants
// coordination_topology mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler mutates `store.topology.{type,maxNodes,redundancy,consensusAlgorithm}`.
// Out-of-enum type / consensusAlgorithm or invalid maxNodes / redundancy would
// produce a topology record downstream coordinators can't honor.

import type { Invariant } from '../../registration.js';
import type { CoordinationTopologyPayload } from '../../handlers/coordination/topology.js';

export type { CoordinationTopologyPayload };

const VALID_ACTIONS = new Set(['get', 'set', 'optimize']);
const VALID_TYPES = new Set(['mesh', 'hierarchical', 'ring', 'star', 'hybrid', 'hierarchical-mesh']);
const VALID_CONSENSUS = new Set(['raft', 'byzantine', 'gossip', 'crdt']);
const MAX_NODES_CAP = 10_000;

/** action must be one of {get, set, optimize} when present. */
const actionInEnum: Invariant<CoordinationTopologyPayload> = ({ recordedPayload }) => {
  const a = recordedPayload.action;
  if (a === undefined) return 'pass';
  if (!VALID_ACTIONS.has(a as string)) {
    return { violated: true, detail: `action must be one of {get,set,optimize}, got ${JSON.stringify(a)}` };
  }
  return 'pass';
};

/** type must be one of {mesh, hierarchical, ring, star, hybrid, hierarchical-mesh}. */
const typeInEnum: Invariant<CoordinationTopologyPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.type;
  if (t === undefined) return 'pass';
  if (!VALID_TYPES.has(t as string)) {
    return { violated: true, detail: `type must be one of {mesh,hierarchical,ring,star,hybrid,hierarchical-mesh}, got ${JSON.stringify(t)}` };
  }
  return 'pass';
};

/** consensusAlgorithm must be one of {raft, byzantine, gossip, crdt}. */
const consensusAlgorithmInEnum: Invariant<CoordinationTopologyPayload> = ({ recordedPayload }) => {
  const c = recordedPayload.consensusAlgorithm;
  if (c === undefined) return 'pass';
  if (!VALID_CONSENSUS.has(c as string)) {
    return { violated: true, detail: `consensusAlgorithm must be one of {raft,byzantine,gossip,crdt}, got ${JSON.stringify(c)}` };
  }
  return 'pass';
};

/** maxNodes, when present, must be a finite positive integer (cap 10_000 to
 *  prevent storage blow-up; a topology with millions of nodes is a caller bug). */
const maxNodesPositiveInteger: Invariant<CoordinationTopologyPayload> = ({ recordedPayload }) => {
  const n = recordedPayload.maxNodes;
  if (n === undefined) return 'pass';
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    return { violated: true, detail: `maxNodes must be a finite integer, got ${String(n)}` };
  }
  if (n < 1 || n > MAX_NODES_CAP) {
    return { violated: true, detail: `maxNodes must be in [1, ${MAX_NODES_CAP}], got ${n}` };
  }
  return 'pass';
};

/** redundancy, when present, must be a finite non-negative integer. */
const redundancyNonNegativeInteger: Invariant<CoordinationTopologyPayload> = ({ recordedPayload }) => {
  const r = recordedPayload.redundancy;
  if (r === undefined) return 'pass';
  if (typeof r !== 'number' || !Number.isFinite(r) || !Number.isInteger(r)) {
    return { violated: true, detail: `redundancy must be a finite integer, got ${String(r)}` };
  }
  if (r < 0) {
    return { violated: true, detail: `redundancy must be >= 0, got ${r}` };
  }
  return 'pass';
};

/** action identity — TAUTOLOGY TODAY. */
const actionEquality: Invariant<CoordinationTopologyPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.action !== recordedPayload.action) {
    return { violated: true, detail: `action divergence: intent='${String(callerIntent.action)}' recorded='${String(recordedPayload.action)}'` };
  }
  return 'pass';
};

export const topologyInvariants: ReadonlyArray<Invariant<CoordinationTopologyPayload>> = [
  actionInEnum,
  typeInEnum,
  consensusAlgorithmInEnum,
  maxNodesPositiveInteger,
  redundancyNonNegativeInteger,
  actionEquality,
];
