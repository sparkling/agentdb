// charter: dispatch
// agentdb_causal_recall read handler (ADR-0180 Phase 6, §Architecture · Read-path
// return shape + §Provenance rollout scope).
//
// Causal-aware reranking site: combines vector similarity with causal-graph uplift
// per ADR-0033 (CausalRecall = α·similarity + β·uplift − γ·latencyCost). Per
// ADR-0180 §Provenance rollout scope, ranked reads MUST surface provenance — the
// rerank path is exactly where ExplainableRecall needs to attribute hits back to
// (storeId, matchType, rawScore, rank) so the recall certificate it issues can
// be derived without a second query. Legacy callers continue to receive the
// flattened `{ id, content, score }[]` shape (back-compat); provenance-aware
// callers pass `includeProvenance: true` at the cli boundary and receive
// `RankedResults<T>` verbatim.
//
// Substrate routing: CausalRecall + CausalMemoryGraph live in the
// PERMANENT_SQLITE_CARVE_OUT per ADR-0166 Amendment 2026-05-11f (axis-separation,
// agentdb_* on SQLite). The handler body — once wired — uses SQLite carve-out via
// `ctx.substrate`; the registration shape here is substrate-agnostic by design.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_causal-recall` handler (line 1202) — validates `query` (non-empty,
// ≤10KB), clamps `k` via `validatePositiveInt`, coerces `include_evidence` to
// boolean, then delegates to the package-level `causalRecall(...)` helper which
// runs the rerank-and-certify pipeline. The cli callsite stays authoritative
// during the migration window — this file establishes the registration shape the
// dispatch path will resolve when the boundary is wired.

import { registerReadHandler, type GuardedRead, type ReadContext } from '../../index.js';
import type { RankedResults } from '../memory/search.js';

/**
 * Input payload mirroring the CLI tool's `agentdb_causal-recall` input shape
 * (agentdb-tools.ts:1205-1213). `includeProvenance` is the dispatch-boundary
 * flag wired separately by the cli schema patch — when true, callers receive
 * `RankedResults<CausalRecallHit>`; when false (default), the dispatch path
 * flattens to the legacy `{ id, content, score }[]` shape.
 */
export interface AgentdbCausalRecallQuery {
  readonly query: string;
  readonly k?: number;
  readonly includeEvidence?: boolean;
  readonly includeProvenance?: boolean;
}

/**
 * Causal-recall hit shape. Mirrors `RerankCandidate` from
 * `src/controllers/CausalRecall.ts` (id + type + content + similarity + utility)
 * so a dispatch-side flatten back to legacy `{ id, content, score }[]` is a
 * field-pick when `includeProvenance: false`. `uplift` + `causalConfidence` are
 * the causal-graph attribution surfaces consumed by ExplainableRecall.
 */
export interface CausalRecallHit {
  readonly id: string;
  readonly type: 'episode' | 'skill' | 'note' | 'fact';
  readonly content: string;
  readonly similarity: number;
  readonly uplift?: number;
  readonly causalConfidence?: number;
  readonly utilityScore: number;
}

// TODO(ADR-0180 Phase 6 wire-up): port the rerank body from
// cli/src/mcp-tools/agentdb-tools.ts agentdb_causal-recall handler:
// (a) resolve the CausalRecall controller via ctx.substrate (PERMANENT_SQLITE_CARVE_OUT,
//     ADR-0166 Amendment 2026-05-11f — CausalMemoryGraph lives on SQLite);
// (b) run vector similarity leg, capturing rawScore per candidate before rerank;
// (c) join causal-graph uplift via CausalMemoryGraph.findEdges (storeId='causal_edges');
// (d) rerank via utility U = α·similarity + β·uplift − γ·latencyCost (ADR-0033);
// (e) emit `RankedResult<CausalRecallHit>[]` with provenance per candidate:
//     `{ storeId, matchType: 'fused' (rerank-merged) | 'semantic', rawScore (pre-rerank
//        similarity), rank (post-rerank position), explanation? (causal uplift trace
//        when includeEvidence) }`;
// (f) ExplainableRecall.issueCertificate consumes provenance directly — eliminates
//     the second-query re-derivation flagged by ADR-0179.
// The cli branch stays in place until the dispatch boundary is wired through;
// this handler is the registration shape the dispatch path will resolve.
export const causalRecallHandler: GuardedRead<AgentdbCausalRecallQuery, RankedResults<CausalRecallHit>> =
  registerReadHandler<AgentdbCausalRecallQuery, RankedResults<CausalRecallHit>>(
    'agentdb_causal_recall',
    async (_ctx: ReadContext, _payload: AgentdbCausalRecallQuery): Promise<RankedResults<CausalRecallHit>> => {
      throw new Error(
        'archivist: agentdb_causal_recall handler body pending Phase 6 wire-up; ' +
        'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts agentdb_causal-recall handler',
      );
    },
    { cacheScope: 'namespace' },
  );
