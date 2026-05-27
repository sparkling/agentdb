// charter: dispatch (producer side)
// Trajectory-step graph-edge producer — ADR-0261 §Confirmation step 0 / §R1.3
// / §R2.1 / §R2.7. The fork-side named consumer (a): when consecutive
// trajectory steps land with src + dst memory ids and an optional embedding,
// dispatch a `trajectory-caused` edge to the `agentdb_graph_edge` handler.
//
// This file ships the dispatch helper. The actual hook wire-up that invokes
// it lives in the cli (`forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-
// tools.ts`, Agent B's deliverable). Keeping the dispatch logic here makes
// the producer trivially testable + keeps the cli wire-up to a single import.
//
// Per ADR-0261 §R2 port-to-upstream alignment:
//   - dispatch goes through the archivist (no private write path)
//   - sourceId/targetId are STRINGS with domain prefixes (`task:`, `pattern:`)
//   - failure surfaces as a throw — caller decides whether to swallow at the
//     hook boundary (NOT here — `feedback-best-effort-must-rethrow-fatals`)
//   - confidence default 0.5, weight default 1.0 (relation-specific semantics
//     deferred to the consumer-side scoring at query time)
//
// Type-enforcement: the `Dispatcher` shape is the minimum surface the helper
// needs (a function that accepts the tool name + payload). Passing
// `Archivist.dispatch` directly satisfies it; tests pass a fake. No
// `import { Archivist }` here — that would create a runtime cycle through the
// archivist barrel.

import type { AgentdbGraphEdgeSavePayload } from '../agentdb/graph-edge.js';

/**
 * Narrow dispatch surface. Production callers pass `archivist.dispatch.bind
 * (archivist)`; tests pass a fake. Returning `Promise<unknown>` matches the
 * archivist's typed dispatch signature without re-exporting the type-map.
 */
export type GraphEdgeDispatcher = (
  tool: 'agentdb_graph_edge',
  payload: AgentdbGraphEdgeSavePayload,
) => Promise<unknown>;

/**
 * Input to the producer — what the hook caller assembles from one
 * trajectory-step pair. `embedding` (optional) is the float32 vector that
 * represents the EDGE (typically the dst memory's embedding; the consumer's
 * similarity search compares edges by embedding). When omitted, the edge is
 * stored without an embedding_ref — useful for early signal capture where the
 * embedding pipeline hasn't run yet.
 */
export interface TrajectoryCausedEdgeInput {
  /** Domain-prefixed source id (e.g. 'task:abc-def'). */
  readonly sourceId: string;
  /** Domain-prefixed target id (e.g. 'pattern:xyz'). */
  readonly targetId: string;
  /** Optional float32 embedding; omitted edges land with embedding_ref NULL. */
  readonly embedding?: Float32Array;
  /** Optional confidence override; defaults to 0.5 per ADR-0261 §Decision Outcome. */
  readonly confidence?: number;
}

/**
 * Dispatch a `trajectory-caused` edge between two consecutive trajectory
 * memory_entries rows. Idempotent under the schema's UNIQUE(source_id,
 * target_id, relation) index — repeated calls reinforce the edge (bumps
 * reinforcement_count + ts) instead of inserting a duplicate.
 *
 * Skips with `false` return when either id is missing or empty (the
 * common shape during trajectory bootstrapping where the first step has no
 * predecessor). All other paths throw on dispatch failure; the caller (the
 * hook handler) is the right layer to decide whether a graph-edge dispatch
 * failure should propagate to the user-facing hook result.
 */
export async function dispatchTrajectoryCaused(
  dispatcher: GraphEdgeDispatcher,
  input: TrajectoryCausedEdgeInput,
): Promise<boolean> {
  if (typeof input.sourceId !== 'string' || input.sourceId.length === 0) return false;
  if (typeof input.targetId !== 'string' || input.targetId.length === 0) return false;
  if (input.sourceId === input.targetId) return false; // self-loop skip
  if (input.embedding !== undefined) {
    if (!(input.embedding instanceof Float32Array) || input.embedding.length === 0) {
      throw new Error(
        'trajectory-step: graph-edge dispatch requires either no embedding or a non-empty Float32Array ' +
          '(invalid embeddings must throw — `feedback-best-effort-must-rethrow-fatals`).',
      );
    }
  }
  await dispatcher('agentdb_graph_edge', {
    action: 'save',
    sourceId: input.sourceId,
    targetId: input.targetId,
    relation: 'trajectory-caused',
    embedding: input.embedding,
    confidence: input.confidence ?? 0.5,
    weight: 1.0,
  });
  return true;
}
