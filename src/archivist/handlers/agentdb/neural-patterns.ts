// charter: dispatch
// agentdb_neural_patterns read handler (ADR-0180 Phase 6, §Architecture ·
// Read-path return shape + §Provenance rollout scope).
//
// Mirrors the CLI tool's read-only `agentdb_neural_patterns` surface
// (`cli/src/mcp-tools/agentdb-tools.ts` agentdbNeuralPatterns, line 1907).
// The tool is GNNService-backed and architecturally read-only — see
// ADR-0180 §Provenance rollout scope (2026-05-14 audit):
//
//   `action: 'similar'` returns ranked similarity matches that benefit from
//   provenance. `action: 'stats'` returns telemetry and is exempt.
//
// ADR-0181 Phase 4 wire-up:
//
//   - `action: 'similar'` reads through `ctx.substrate.vectorSearch` against the
//     RVF `agentdb_pattern_store` — the same store the `agentdb_pattern_store`
//     mutation persists pattern vectors into. The supplied `embedding` payload
//     is the query vector; topK ranking comes from the substrate's HNSW pass.
//   - `action: 'stats'` is a GNNService-only telemetry surface (engine type,
//     init flag, cached pattern count). GNNService is a compute-only service
//     with no persistence layer (controller-registry.ts:1566-1576) — there is
//     no substrate read that can satisfy this action. Per `feedback-no-fallbacks`
//     the handler fails loud rather than silently returning empty telemetry; the
//     cli `agentdb_neural_patterns` handler remains authoritative for `stats`
//     callers (see ESCAPE-HATCH note below).
//
// ESCAPE-HATCH (`stats` action): the `EmbeddingScorer` + RVF substrate cannot
// substitute for a GNNService telemetry probe — `engineType` / `initialized` /
// `cachedPatterns.length` live on the controller, not in the persisted vector
// store. Callers that need `stats` must continue routing through the cli
// surface until the dispatch boundary threads GNNService onto `ReadContext`
// as a narrow capability. This is the same shape ADR-0181 deferred for
// `agentdb_route` mutation's TaskRouter dependency — capabilities not yet
// in `ReadCapabilities`/`MutationCapabilities` block their handlers from
// going substrate-only.
//
// PHASE 5 CARRY-FORWARD (gate for cli delegation):
//   `action: 'stats'` is NOT move-ready. When Phase 5 delegates the cli
//   `agentdb_neural_patterns` MCP tool to the archivist, every
//   `{ action: 'stats' }` call would hard-fail through the loud throw below.
//   The cli `agentdb_neural_patterns` handler MUST remain authoritative for
//   the stats action until `ReadCapabilities` gains a `GNNService` (or
//   equivalent telemetry) capability — track this as a Phase 5 gate item.
//   Without it, the dispatch boundary cannot move wholesale for this tool.
//   The `similar` action IS Phase-5-move-ready (substrate-backed, payload-
//   validated, fully ranked). Phase 5 delegation must therefore be partial-
//   by-action, OR the tool stays cli-authoritative until both actions have
//   substrate paths.
//
// Type-enforcement: `ctx.substrate` is read-only narrowing (`ReadContext`,
// no audit, no guard). Per ADR-0180 §Read-path cache writes, this handler MAY
// populate GNNService in-process pattern caches without invoking MutationGuard
// — those writes die with the process.

import { registerReadHandler, type GuardedRead, type ReadContext, type StoreId } from '../../index.js';
import type { RankedResult, RankedResults } from '../memory/search.js';

/**
 * Input payload mirroring the CLI tool's `agentdb_neural_patterns` input shape
 * (agentdb-tools.ts:1910-1937). The `action` discriminant gates the response
 * shape: `stats` returns telemetry, `similar` returns ranked similarity matches.
 *
 * Per ADR-0180 §Provenance rollout scope, `includeProvenance` is honoured ONLY
 * on the `similar` action's response path — `stats` is provenance-exempt.
 */
export interface AgentdbNeuralPatternsQuery {
  readonly action?: 'stats' | 'similar';
  readonly pattern?: string;
  readonly type?: string;
  readonly embedding?: readonly number[];
  readonly topK?: number;
  readonly includeProvenance?: boolean;
}

/**
 * Similarity hit shape — one per result returned by the RVF substrate's
 * vectorSearch over the `agentdb_pattern_store` corpus. The cli surface
 * returns `{ index, similarity }`; the archivist read shape adds an `id`
 * derived from the substrate's `SearchResult.id` so RankedResult provenance
 * can attribute back without a second query.
 */
export interface NeuralPatternHit {
  readonly index: number;
  readonly similarity: number;
  readonly id: string;
}

/**
 * `similar` response shape — the discriminated read result. Returns
 * `RankedResults<NeuralPatternHit>` so the cli boundary can field-pick the
 * legacy `{ index, similarity }[]` shape OR surface provenance verbatim per
 * `includeProvenance` at the cli dispatch boundary.
 */
export type AgentdbNeuralPatternsResult = RankedResults<NeuralPatternHit>;

const STORE_ID = 'agentdb_pattern_store' as StoreId;
const DEFAULT_TOP_K = 5;

/**
 * Substrate-returned shape for pattern vectors. `vectorSearch` returns the
 * full `SearchResult` (`id`/`distance`/`similarity`/`metadata`) as `item`; the
 * handler reads `id` + `similarity` from the substrate's returned object and
 * builds the response hit from scratch.
 */
interface PatternSearchItem {
  readonly id: string;
  readonly similarity: number;
  readonly metadata?: Record<string, unknown>;
}

export const neuralPatternsHandler: GuardedRead<AgentdbNeuralPatternsQuery, AgentdbNeuralPatternsResult> =
  registerReadHandler<AgentdbNeuralPatternsQuery, AgentdbNeuralPatternsResult>(
    'agentdb_neural_patterns',
    async (ctx: ReadContext, payload: AgentdbNeuralPatternsQuery): Promise<AgentdbNeuralPatternsResult> => {
      const action = payload.action ?? 'stats';

      if (action === 'stats') {
        // GNNService telemetry has no substrate read — see ESCAPE-HATCH in the
        // module header. Failing loud rather than returning empty telemetry
        // honours `feedback-no-fallbacks`: silent stats would let the cli's
        // ADR-0090 B5 acceptance check pass via the wrong path.
        throw new Error(
          "archivist: agentdb_neural_patterns 'stats' action is not substrate-backed — " +
            'GNNService telemetry (engineType/initialized/cachedPatterns) lives on the ' +
            'controller, not in the persisted vector store. Until ReadCapabilities ' +
            'threads a GNNService capability, the cli agentdb_neural_patterns handler ' +
            'remains authoritative for the stats action.',
        );
      }

      if (action !== 'similar') {
        throw new Error(
          `archivist: agentdb_neural_patterns unsupported action '${action}' (valid: stats, similar)`,
        );
      }

      // `similar` action: vectorSearch over agentdb_pattern_store. The supplied
      // embedding is the query vector; failing loud on absence rather than
      // synthesizing a placeholder (the cli surface's one-hot fallback is a
      // diagnostic shape — appropriate at the MCP edge, not at the archivist
      // read boundary where `feedback-no-fallbacks` rules).
      if (!Array.isArray(payload.embedding) || payload.embedding.length === 0) {
        throw new Error(
          "archivist: agentdb_neural_patterns 'similar' action requires a non-empty " +
            'embedding (number[]). The cli boundary may synthesize a placeholder vector ' +
            'for diagnostic callers, but the archivist read path takes the embedding ' +
            'verbatim.',
        );
      }
      if (!payload.embedding.every((n) => typeof n === 'number')) {
        throw new Error(
          "archivist: agentdb_neural_patterns 'similar' embedding must contain only numbers",
        );
      }

      const vector = new Float32Array(payload.embedding);
      const topK = payload.topK ?? DEFAULT_TOP_K;
      const hits = await ctx.substrate.vectorSearch<PatternSearchItem>({
        storeId: STORE_ID,
        vector,
        topK,
      });

      // Build the ranked array from scratch (substrate-semantic immutability):
      // each NeuralPatternHit aliases nothing from the substrate's returned
      // SearchResult objects. `index` mirrors the cli surface's positional
      // discriminant (0-based ordering in the result set).
      const ranked: RankedResult<NeuralPatternHit>[] = [];
      for (let index = 0; index < hits.length; index++) {
        const hit = hits[index];
        ranked.push({
          item: {
            index,
            similarity: hit.score,
            id: hit.item.id,
          },
          score: hit.score,
          provenance: {
            storeId: 'gnnService',
            matchType: 'semantic',
            rawScore: hit.score,
            rank: index + 1,
          },
        });
      }
      return ranked;
    },
    { cacheScope: 'store' },
  );
