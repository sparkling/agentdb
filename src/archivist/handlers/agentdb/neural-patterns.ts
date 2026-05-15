// charter: dispatch
// agentdb_neural_patterns read handler (ADR-0180 Phase 6, §Architecture ·
// Read-path return shape + §Provenance rollout scope).
//
// Mirrors the CLI tool's read-only `agentdb_neural_patterns` surface
// (`cli/src/mcp-tools/agentdb-tools.ts` agentdbNeuralPatterns, line 1892).
// The tool is GNNService-backed and architecturally read-only — see
// ADR-0180 §Provenance rollout scope (2026-05-14 audit):
//
//   `action: 'similar'` returns ranked similarity matches that benefit from
//   provenance. `action: 'stats'` returns telemetry and is exempt.
//
// Per that scope, `includeProvenance` is wired on the `similar` action only.
// The `stats` response is unchanged shape; the `similar` response surfaces
// `RankedResults<NeuralPatternHit>` verbatim when `includeProvenance: true`,
// otherwise legacy `{ index, similarity }[]` is reconstituted at the cli
// dispatch boundary via a field-pick.
//
// The mutation siblings (`store`, `delete`) live in
// `handlers/neural/patterns.ts` as `GuardedWrite<NeuralPatternsMutationPayload>`
// — this file is the READ-only counterpart and does NOT replace the cli
// `agentdb_neural_patterns` handler, which continues to route through
// `getController('gnnService')` until the dispatch boundary is wired through.
//
// Type-enforcement: `ctx.substrate` is read-only narrowing (`ReadContext`,
// no audit, no guard). Per ADR-0180 §Read-path cache writes, this handler MAY
// populate GNNService in-process pattern caches without invoking MutationGuard
// — those writes die with the process.

import { registerReadHandler, type GuardedRead, type ReadContext } from '../../index.js';
import type { RankedResults } from '../memory/search.js';

/**
 * Input payload mirroring the CLI tool's `agentdb_neural_patterns` input shape
 * (agentdb-tools.ts:1895-1916). The `action` discriminant gates the response
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
  readonly includeProvenance?: boolean;
}

/**
 * Telemetry shape for `action: 'stats'`. Mirrors the cli surface's
 * proof-of-life fields (controller, engine, init flag, cached count) plus
 * the optional `stats` object emitted by `GNNService.getStats()`.
 */
export interface NeuralPatternsStats {
  readonly action: 'stats';
  readonly controller: 'gnnService';
  readonly engine: string;
  readonly initialized: boolean;
  readonly stats: Record<string, unknown>;
  readonly count: number;
  readonly marker: string | null;
  readonly type: string;
}

/**
 * Similarity hit shape — one per result returned by
 * `GNNService.findSimilarPatterns(vec, corpus)`. The cli surface returns
 * `{ index, similarity }`; the archivist read shape adds an opaque `id`
 * derived from the corpus position so RankedResult provenance can attribute
 * back without a second query.
 */
export interface NeuralPatternHit {
  readonly index: number;
  readonly similarity: number;
  readonly id: string;
}

/**
 * Discriminated union of read responses. `stats` is unchanged shape (no
 * provenance); `similar` returns `RankedResults<NeuralPatternHit>` when
 * `includeProvenance: true`, otherwise the legacy flat hit array.
 */
export type AgentdbNeuralPatternsResult =
  | NeuralPatternsStats
  | {
      readonly action: 'similar';
      readonly controller: 'gnnService';
      readonly marker: string | null;
      readonly type: string;
      readonly patterns: ReadonlyArray<NeuralPatternHit> | RankedResults<NeuralPatternHit>;
      readonly count: number;
    };

// TODO(ADR-0180 Phase 6 wire-up): port the GNNService body from
// cli/src/mcp-tools/agentdb-tools.ts agentdbNeuralPatterns handler:
// (a) resolve gnnService via ctx.substrate (read-only narrow);
// (b) `stats` action — call getEngineType / isInitialized / getStats /
//     getPatternCount (or cachedPatterns.length) — no provenance;
// (c) `similar` action — call findSimilarPatterns(vec, corpus) under the
//     2s timeout race; if includeProvenance:true, emit
//     RankedResult<NeuralPatternHit>[] with `{ storeId: 'gnnService',
//     matchType: 'semantic', rawScore: similarity, rank }`; otherwise
//     return the flat hit array (legacy shape).
// The cli branch stays in place until the dispatch boundary is wired through.
export const neuralPatternsHandler: GuardedRead<AgentdbNeuralPatternsQuery, AgentdbNeuralPatternsResult> =
  registerReadHandler<AgentdbNeuralPatternsQuery, AgentdbNeuralPatternsResult>(
    'agentdb_neural_patterns',
    async (_ctx: ReadContext, _payload: AgentdbNeuralPatternsQuery): Promise<AgentdbNeuralPatternsResult> => {
      throw new Error(
        'archivist: agentdb_neural_patterns handler body pending Phase 6 wire-up; ' +
        'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts agentdbNeuralPatterns handler',
      );
    },
    { cacheScope: 'store' },
  );
