// charter: dispatch (producer side)
// Post-task graph-edge producer — ADR-0261 §Confirmation step 0 / §R1.3 /
// §R2.1 / §R2.7. The fork-side named consumer (b): on `success === true`,
// writes `reinforced-by` edges from the task's output memory back to its
// retrieved-context memories.
//
// One save per (output, context) pair. The schema's UNIQUE(source_id,
// target_id, relation) index makes repeat dispatches reinforce the edge
// (`ON CONFLICT DO UPDATE`) rather than inserting duplicates — exactly the
// "graph that forgets" use case: a successful task in which Context-A was
// useful again strengthens Output→Context-A.
//
// Direction (src = output, dst = context) is the "I owe my success to ..."
// shape. Read-side handlers (graph-query semantic mode, graph-pathfinder
// temporal-centrality) traverse this edge backward to find frequently-helpful
// context.
//
// As with trajectory-step.ts: this file is the producer helper; the actual
// hook wire-up calling it lives in the cli's hooks-tools.ts. No archivist
// barrel import to avoid a runtime cycle. sourceId/targetId are STRINGS per
// ADR-0261 §R2 port-to-upstream alignment.

import type { AgentdbGraphEdgeSavePayload } from '../agentdb/graph-edge.js';
import type { GraphEdgeDispatcher } from './trajectory-step.js';

export type { GraphEdgeDispatcher } from './trajectory-step.js';

/** Input shape — output memory id + one context memory id + optional embedding. */
export interface ReinforcedByEdgeInput {
  /** Domain-prefixed output id (e.g. 'memory:output-abc'). */
  readonly outputMemoryId: string;
  /** Domain-prefixed context id (e.g. 'memory:ctx-xyz'). */
  readonly contextMemoryId: string;
  /**
   * Optional float32 embedding for the edge. Per ADR §Decision Outcome #8,
   * when the caller has the output memory's embedding handy that's the
   * natural choice (rotates toward the producer's signal); when not, callers
   * may supply the context memory's embedding or any signal-bearing vector.
   * Omit to land an edge with embedding_ref NULL. The encoder is config-chain
   * dim-agnostic — whatever the caller passes must match the substrate's
   * configured embedding dim.
   */
  readonly embedding?: Float32Array;
  /** Optional confidence; defaults to 0.5. */
  readonly confidence?: number;
}

/**
 * Dispatch a `reinforced-by` edge for a single (output, context) pair.
 * Repeated calls reinforce the edge. Returns `false` for empty ids or
 * self-loops; throws on dispatch failure.
 */
export async function dispatchReinforcedBy(
  dispatcher: GraphEdgeDispatcher,
  input: ReinforcedByEdgeInput,
): Promise<boolean> {
  if (typeof input.outputMemoryId !== 'string' || input.outputMemoryId.length === 0) return false;
  if (typeof input.contextMemoryId !== 'string' || input.contextMemoryId.length === 0) return false;
  if (input.outputMemoryId === input.contextMemoryId) return false;
  if (input.embedding !== undefined) {
    if (!(input.embedding instanceof Float32Array) || input.embedding.length === 0) {
      throw new Error(
        'post-task: reinforced-by graph-edge dispatch requires either no embedding or a non-empty Float32Array.',
      );
    }
  }
  await dispatcher('agentdb_graph_edge', {
    action: 'save',
    sourceId: input.outputMemoryId,
    targetId: input.contextMemoryId,
    relation: 'reinforced-by',
    embedding: input.embedding,
    confidence: input.confidence ?? 0.5,
    weight: 1.0,
  } satisfies AgentdbGraphEdgeSavePayload);
  return true;
}

/**
 * Bulk variant — dispatch one `reinforced-by` edge per retrieved-context
 * memory id. Returns the count of edges that were attempted to dispatch
 * (skipped self-loops and bad ids are not counted). Throws on the first
 * dispatch failure — partial-success semantics are NOT allowed per
 * `feedback-best-effort-must-rethrow-fatals` / `feedback-no-fallbacks`. The
 * caller chooses whether to wrap with a higher-level retry policy.
 */
export async function dispatchReinforcedByBatch(
  dispatcher: GraphEdgeDispatcher,
  args: {
    readonly outputMemoryId: string;
    readonly contextMemoryIds: ReadonlyArray<string>;
    readonly embedding?: Float32Array;
    readonly confidence?: number;
  },
): Promise<number> {
  let dispatched = 0;
  for (const contextMemoryId of args.contextMemoryIds) {
    const ok = await dispatchReinforcedBy(dispatcher, {
      outputMemoryId: args.outputMemoryId,
      contextMemoryId,
      embedding: args.embedding,
      confidence: args.confidence,
    });
    if (ok) dispatched++;
  }
  return dispatched;
}
