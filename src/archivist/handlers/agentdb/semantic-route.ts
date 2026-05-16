// charter: dispatch
// agentdb_semantic_route read handler (ADR-0180 Phase 6, §Architecture · Read-path
// return shape + §Provenance rollout scope).
//
// ADR-0181 Phase 4 wire-up: the handler reads through `ctx.substrate.vectorSearch`
// against the RVF `agentdb_route` store — the same store the `agentdb_route`
// mutation persists routing trajectory vectors into. Each hit's metadata
// carries `route` + `confidence` + optional per-route metadata; vectorSearch
// returns hits already ordered by HNSW similarity (best-first), so the read
// path is a filter + shape pass — no vector math in the handler.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_semantic_route` handler (line 691) — delegates to
// `getController<any>('semanticRouter').route(input)`. The cli's `.route()` path
// is a single-best-match read; the archivist surface ranks the persisted
// trajectory vectors directly so caller-side fusion (Phase 6 §Read-path) can
// surface candidate top-K rather than the controller's single-pick output.
//
// Type-enforcement: `ctx.substrate` is read-only narrowing (`ReadContext`, no
// audit, no guard). The `EmbeddingScorer` capability is required to vectorize
// the input — its `requireEmbeddingScorer()` accessor fails loud if no factory
// was wired into `ArchivistInitConfig` (`feedback-no-fallbacks`). Cache scope is
// `'global'` because the router trajectory is process-global rather than
// namespaced — the input string is the only cache partition.

import { registerReadHandler } from '../../registration.js';
import type { GuardedRead, ReadContext, StoreId } from '../../index.js';
import type { RankedResult, RankedResults } from '../memory/search.js';

export interface AgentdbSemanticRouteQuery {
  readonly input: string;
  readonly topK?: number;
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

const STORE_ID = 'agentdb_route' as StoreId;
const DEFAULT_TOP_K = 5;

/**
 * Shape of the metadata each `agentdb_route` mutation persists per trajectory
 * vector. Mirrors the cli `routeTask(...)` return shape (`route`/`confidence`/
 * optional free-form provenance). The substrate's `vectorSearch` returns the
 * full `SearchResult` (`id`/`distance`/`similarity`/`metadata`) as the `item`;
 * this handler reads the `metadata` shape verbatim and projects it onto
 * `SemanticRouteHit`.
 */
interface RouteSearchItem {
  readonly id: string;
  readonly similarity: number;
  readonly metadata?: {
    readonly route?: unknown;
    readonly confidence?: unknown;
    readonly [k: string]: unknown;
  };
}

export const semanticRouteHandler: GuardedRead<AgentdbSemanticRouteQuery, RankedResults<SemanticRouteHit>> =
  registerReadHandler<AgentdbSemanticRouteQuery, RankedResults<SemanticRouteHit>>(
    'agentdb_semantic_route',
    async (ctx: ReadContext, payload: AgentdbSemanticRouteQuery): Promise<RankedResults<SemanticRouteHit>> => {
      // ADR-0181 Item 2 (2026-05-15) — controller-first branch.
      //
      // The cli `agentdb_semantic_add_route` tool persists routes to (a) the
      // SemanticRouter's in-memory `Map<string, RouteConfig>` and (b)
      // `.claude-flow/semantic-routes.json` (re-hydrated on construction at
      // controller-registry.ts:1412-1432). Routes are NOT written to the RVF
      // `agentdb_route` substrate today — substrate-backed route persistence
      // is future-ADR scope.
      //
      // When the `SemanticRouteReader` capability is wired (cli adapter at
      // archivist-init.ts `makeCliSemanticRouteReader`), reach the
      // SemanticRouter via the narrow surface and lift its single-pick result
      // into the canonical `RankedResults<SemanticRouteHit>` shape. Empty
      // result (`null`) → empty array; the cli wrapper at agentdb-tools.ts
      // :778 already handles `top` undefined as `{success:false, route:null,
      // error:'No route matched'}`.
      //
      // The substrate `vectorSearch` path BELOW is reserved for the future
      // RVF-backed-route ADR. Until then it would always return [] (no writes
      // populate the store) — bypassing it is the only honest behaviour.
      if (ctx.capabilities.semanticRouteReader) {
        const reader = ctx.capabilities.requireSemanticRouteReader();
        const result = await reader.route(payload.input);
        if (!result) return [];
        const item: SemanticRouteHit = result.metadata
          ? { route: result.route, confidence: result.confidence, metadata: result.metadata }
          : { route: result.route, confidence: result.confidence };
        return [
          {
            item,
            score: result.confidence,
            provenance: {
              storeId: 'semantic-router',
              matchType: 'semantic',
              rawScore: result.confidence,
              rank: 1,
              matchedField: 'input',
            },
          },
        ];
      }

      const embedder = ctx.capabilities.requireEmbeddingScorer();
      const vector = await embedder.embed(payload.input);
      const topK = payload.topK ?? DEFAULT_TOP_K;

      const hits = await ctx.substrate.vectorSearch<RouteSearchItem>({
        storeId: STORE_ID,
        vector,
        topK,
      });

      // Build the ranked array from scratch (substrate-semantic immutability):
      // every per-hit field is read off the substrate's returned shape; no
      // reuse of the substrate's array or per-item references at the type level.
      const ranked: RankedResult<SemanticRouteHit>[] = [];
      for (let index = 0; index < hits.length; index++) {
        const hit = hits[index];
        const meta = hit.item.metadata;
        const route = typeof meta?.route === 'string' ? meta.route : hit.item.id;
        const confidence = typeof meta?.confidence === 'number' ? meta.confidence : hit.score;
        const extraMetadata = stripKnownFields(meta);
        const item: SemanticRouteHit = extraMetadata
          ? { route, confidence, metadata: extraMetadata }
          : { route, confidence };
        ranked.push({
          item,
          score: hit.score,
          provenance: {
            storeId: 'semantic-router',
            matchType: 'semantic',
            rawScore: hit.score,
            rank: index + 1,
            matchedField: 'input',
          },
        });
      }
      return ranked;
    },
    { cacheScope: 'global' },
  );

/**
 * Project the metadata object onto an "extras" record — strip the fields the
 * handler already surfaces on the top-level hit (`route`, `confidence`). Returns
 * `undefined` when no extras remain so the optional `metadata` field on
 * `SemanticRouteHit` is genuinely absent rather than `{}` (matches the
 * underlying SemanticRouter's `route(input)` shape — `metadata` is opt-in).
 */
function stripKnownFields(
  meta: RouteSearchItem['metadata'] | undefined,
): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const extras: Record<string, unknown> = {};
  let hasAny = false;
  for (const key of Object.keys(meta)) {
    if (key === 'route' || key === 'confidence') continue;
    extras[key] = meta[key];
    hasAny = true;
  }
  return hasAny ? extras : undefined;
}
