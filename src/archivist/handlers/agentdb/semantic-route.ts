// charter: dispatch
// agentdb_semantic_route read handler (ADR-0180 Phase 6, §Architecture · Read-path
// return shape + §Provenance rollout scope).
//
// Pure intent-classification read: the SemanticRouter `route(input)` call returns
// a single best-match route (label + confidence + optional metadata) without
// mutating router state — unlike `agentdb_route` which writes a routing decision
// trajectory through BanditLearner / ReflexionMemory. That makes this a
// `GuardedRead<AgentdbSemanticRouteQuery, RankedResults<SemanticRouteHit>>`:
// reads carry no audit ceremony (ADR-0180 §Audit chain — reads are passthroughs).
//
// Even though the underlying controller returns a single best match, we register
// as `RankedResults<T>` to keep shape parity with the rest of the Phase 6 read
// surface (filtered-search, hierarchical-recall, reflexion-retrieve). A
// single-entry result with `rank: 1` is the natural ranked-form of "best match";
// callers that opt into `includeProvenance: true` at the cli boundary get the
// provenance triple verbatim (storeId='semantic-router', matchType='semantic',
// rawScore=confidence, rank=1).
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_semantic_route` handler (line 691) — delegates to
// `getController<any>('semanticRouter').route(input)`. Per Phase 6 wire-up policy,
// the cli callsite stays authoritative during the migration window; this file
// establishes the registration shape the dispatch path will resolve.
//
// Type-enforcement: `ctx.substrate` is read-only narrowing (`ReadContext`, no
// audit, no guard). Cache scope is `'global'` because the router model is process-
// global rather than namespaced — the input string is the only cache partition.

import { registerReadHandler, type GuardedRead, type ReadContext } from '../../index.js';
import type { RankedResults } from '../memory/search.js';

export interface AgentdbSemanticRouteQuery {
  readonly input: string;
}

/**
 * Semantic-route hit shape. Mirrors the underlying SemanticRouter `route(input)`
 * return shape (route label + confidence + optional per-route metadata) so a
 * dispatch-side flatten back to the legacy `{ route, confidence, ... }` object
 * is a field-pick when `includeProvenance: false`.
 */
export interface SemanticRouteHit {
  readonly route: string;
  readonly confidence: number;
  readonly metadata?: Record<string, unknown>;
}

// TODO(ADR-0180 Phase 6 wire-up): port the route body from
// cli/src/mcp-tools/agentdb-tools.ts agentdb_semantic_route handler:
// (a) resolve the SemanticRouter controller via ctx.substrate (read-only narrow);
// (b) invoke `ctrl.route(input)` capturing the returned label + confidence;
// (c) emit a single-entry `RankedResult<SemanticRouteHit>` with provenance:
//     `{ storeId: 'semantic-router', matchType: 'semantic', rawScore: confidence,
//        rank: 1 }`. If the router exposes alternates (top-K route candidates),
//     emit each as its own ranked entry preserving the model's ordering.
// The cli branch stays in place until the dispatch boundary is wired through;
// this handler is the registration shape the dispatch path will resolve.
export const semanticRouteHandler: GuardedRead<AgentdbSemanticRouteQuery, RankedResults<SemanticRouteHit>> =
  registerReadHandler<AgentdbSemanticRouteQuery, RankedResults<SemanticRouteHit>>(
    'agentdb_semantic_route',
    async (_ctx: ReadContext, _payload: AgentdbSemanticRouteQuery): Promise<RankedResults<SemanticRouteHit>> => {
      throw new Error(
        'archivist: agentdb_semantic_route handler body pending Phase 6 wire-up; ' +
        'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts agentdb_semantic_route handler',
      );
    },
    { cacheScope: 'global' },
  );
