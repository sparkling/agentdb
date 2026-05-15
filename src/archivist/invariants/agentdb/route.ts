// charter: mutation-invariants
// agentdb_route mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// Routing decisions persist to the trajectory store; an empty task body would
// embed to a degenerate vector and pollute the BanditLearner's per-namespace history.

import type { Invariant } from '../../registration.js';
import type { AgentdbRoutePayload } from '../../handlers/agentdb/route.js';

export type { AgentdbRoutePayload };

/** task must be a non-empty string. The handler embeds it via EmbeddingScorer;
 *  empty-string embeddings collapse to zero-vectors that pollute HNSW recall. */
const taskNonEmpty: Invariant<AgentdbRoutePayload> = ({ recordedPayload }) => {
  const t = recordedPayload.task;
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `task must be a non-empty string, got ${typeof t} length=${(t as string)?.length ?? 0}` };
  }
  return 'pass';
};

/** task identity. */
const taskEquality: Invariant<AgentdbRoutePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.task !== recordedPayload.task) {
    return {
      violated: true,
      detail: `task divergence: intent.length=${callerIntent.task?.length ?? 0} recorded.length=${recordedPayload.task?.length ?? 0}`,
    };
  }
  return 'pass';
};

/** namespace identity (handler defaults to 'default' internally; recorded payload
 *  retains the original — divergence here means the wrong-namespace branch ran). */
const namespaceEquality: Invariant<AgentdbRoutePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.namespace !== recordedPayload.namespace) {
    return {
      violated: true,
      detail: `namespace divergence: intent='${String(callerIntent.namespace)}' recorded='${String(recordedPayload.namespace)}'`,
    };
  }
  return 'pass';
};

export const routeInvariants: ReadonlyArray<Invariant<AgentdbRoutePayload>> = [
  taskNonEmpty,
  taskEquality,
  namespaceEquality,
];
