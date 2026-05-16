// charter: mutation-invariants
// coordination_node mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler mutates `store.nodes[nodeId]` for add/remove/heartbeat actions.
// Out-of-enum action / status or empty nodeId would corrupt the node roster.

import type { Invariant } from '../../registration.js';
import type { CoordinationNodePayload } from '../../handlers/coordination/node.js';

export type { CoordinationNodePayload };

const VALID_ACTIONS = new Set(['list', 'add', 'remove', 'heartbeat', 'status', 'info']);
const VALID_STATUSES = new Set(['active', 'degraded', 'offline']);
const NODE_ID_MAX = 200;

/** action must be one of {list, add, remove, heartbeat, status, info} when present. */
const actionInEnum: Invariant<CoordinationNodePayload> = ({ recordedPayload }) => {
  const a = recordedPayload.action;
  if (a === undefined) return 'pass';
  if (!VALID_ACTIONS.has(a as string)) {
    return { violated: true, detail: `action must be one of {list,add,remove,heartbeat,status,info}, got ${JSON.stringify(a)}` };
  }
  return 'pass';
};

/** status, when present, must be one of {active, degraded, offline}. */
const statusInEnum: Invariant<CoordinationNodePayload> = ({ recordedPayload }) => {
  const s = recordedPayload.status;
  if (s === undefined) return 'pass';
  if (!VALID_STATUSES.has(s as string)) {
    return { violated: true, detail: `status must be one of {active,degraded,offline}, got ${JSON.stringify(s)}` };
  }
  return 'pass';
};

/** nodeId, when present, must be a non-empty string ≤200 chars. The substrate
 *  routes per nodeId; an empty value would yield an unaddressable record (the
 *  handler mints `node-${Date.now()}` only when nodeId is undefined, not when
 *  empty). */
const nodeIdWellFormed: Invariant<CoordinationNodePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.nodeId;
  if (id === undefined) return 'pass';
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `nodeId must be a non-empty string when present, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > NODE_ID_MAX) {
    return { violated: true, detail: `nodeId length ${id.length} exceeds max ${NODE_ID_MAX}` };
  }
  return 'pass';
};

/** action identity — TAUTOLOGY TODAY (dispatch passes same object). */
const actionEquality: Invariant<CoordinationNodePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.action !== recordedPayload.action) {
    return { violated: true, detail: `action divergence: intent='${String(callerIntent.action)}' recorded='${String(recordedPayload.action)}'` };
  }
  return 'pass';
};

/** nodeId identity — TAUTOLOGY TODAY. */
const nodeIdEquality: Invariant<CoordinationNodePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.nodeId !== recordedPayload.nodeId) {
    return { violated: true, detail: `nodeId divergence: intent='${String(callerIntent.nodeId)}' recorded='${String(recordedPayload.nodeId)}'` };
  }
  return 'pass';
};

export const nodeInvariants: ReadonlyArray<Invariant<CoordinationNodePayload>> = [
  actionInEnum,
  statusInEnum,
  nodeIdWellFormed,
  actionEquality,
  nodeIdEquality,
];
