// charter: dispatch
// agentdb_causal_recall read handler (ADR-0180 Phase 6, §Architecture · Read-path
// return shape + §Provenance rollout scope).
//
// Causal-aware reranking site: in the cli, `CausalRecall.recall()` composes
// vector similarity AND causal-graph uplift per ADR-0033
// (U = α·similarity + β·uplift − γ·latencyCost). Per ADR-0180 §Provenance
// rollout scope, ranked reads MUST surface provenance — the rerank path is
// exactly where ExplainableRecall needs to attribute hits back to
// (storeId, matchType, rawScore, rank) so the recall certificate it issues can
// be derived without a second query.
//
// Substrate routing: CausalRecall + CausalMemoryGraph live in the
// PERMANENT_SQLITE_CARVE_OUT per ADR-0166 Amendment 2026-05-11f (axis-separation,
// agentdb_* on SQLite). The `causal_edges` table (agentdb-mcp-server.ts:137)
// is the read surface this handler queries — `(from_memory_id,
// from_memory_type, to_memory_id, to_memory_type, similarity, uplift,
// confidence, sample_size, mechanism)` per causal-graph row.
//
// Scope discipline (Phase 4): the full ADR-0033 utility composition needs
// (a) a query embedding (EmbeddingScorer) AND (b) a vector index keyed by
// memory id to materialize the `similarity` leg. The narrow read-capability
// bundle (ReadCapabilities — capabilities.ts:178) threads `embeddingScorer`
// but no vector-backend handle, and the SQLite carve-out has no vector index
// of its own (`makeSqliteSubstrate.vectorSearch` throws by design —
// substrates/sqlite-store.ts:182). The carve-out substrate's read surface IS
// the causal-edge table; the vector leg lives in the RVF family and would
// require a second-substrate join that this Phase deliberately defers.
//
// So this handler ranks candidates by the PRE-COMPUTED causal `uplift` (with
// `confidence`/`sample_size` gating per ADR-0033's `minConfidence` knob) — the
// substrate-native carve-out contribution — and emits provenance verbatim.
// Hits surface the *effect-side* memory id (the candidate the causal edge
// promotes) and surface `uplift` + `causalConfidence` on the hit so
// ExplainableRecall keeps full attribution. The cli's `causalRecall(...)`
// stays authoritative for the full α·sim + β·uplift composition until a future
// phase threads a CausalRecall capability that owns both legs.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_causal-recall` handler (line 1237) — validates `query` (non-empty,
// ≤10KB), clamps `k` via `validatePositiveInt`, coerces `include_evidence` to
// boolean, then delegates to the package-level `causalRecall(...)` helper
// which runs the full rerank-and-certify pipeline.
//
// PHASE 5 DELEGATION CARRY-FORWARD — DO NOT SILENTLY FLIP DISPATCH (DA round 2):
// MISSING DEPENDENCY: a `CausalRecall` capability surfacing BOTH the
// `α·sim` leg (query embedding + memory-id-keyed vector index for similarity)
// AND the `γ·latencyCost` leg (per-candidate latency telemetry). Handler
// owns the `β·uplift` leg via substrate-native causal_edges read.
//
// Until that capability lands, the cli `causalRecall(...)` path REMAINS the
// authoritative caller for ranked-similarity scenarios. This dispatch surface
// ranks by causal uplift alone (β=1, α=γ=0) and is the correct delegate ONLY
// when callers want substrate-native causal-edge browsing — NOT when they want
// ADR-0033 full-utility ranking (`U = α·sim + β·uplift − γ·latencyCost`).
//
// A Phase 5 wire-up that points `agentdb_causal-recall`'s cli handler at
// `dispatchRead('agentdb_causal_recall', ...)` unconditionally would silently
// downgrade ranking from `α·sim + β·uplift − γ·latencyCost` to `β·uplift` —
// a behavior regression. The matchType change (`'fused'` → `'semantic'`) is
// the dispatch-contract signal that ranking semantics shifted; Phase 5 MUST
// either (a) keep the cli causalRecall(...) path live for the full-utility
// case, or (b) gate dispatch on a caller-intent flag once one exists in the
// payload (no such flag exists in the current `agentdb_causal-recall` schema;
// ADR-0033 α/β/γ weights are CausalRecall instance-config, not per-call).

import { registerReadHandler, type GuardedRead, type ReadContext, type StoreId } from '../../index.js';
import type { RankedResult, RankedResults } from '../memory/search.js';

const STORE_ID = 'agentdb_causal_recall' as StoreId;

/**
 * Input payload mirroring the CLI tool's `agentdb_causal-recall` input shape
 * (agentdb-tools.ts:1240-1248).
 */
export interface AgentdbCausalRecallQuery {
  readonly query: string;
  readonly k?: number;
  readonly includeEvidence?: boolean;
  /** Minimum causal confidence — ADR-0033 `minConfidence` (default 0.6). */
  readonly minConfidence?: number;
}

/**
 * Causal-recall hit shape. Mirrors `RerankCandidate` from
 * `src/controllers/CausalRecall.ts` (id + type + content + similarity +
 * utility) so a dispatch-side flatten back to legacy `{ id, content, score }[]`
 * is a field-pick when `includeProvenance: false`. `uplift` +
 * `causalConfidence` are the causal-graph attribution surfaces consumed by
 * ExplainableRecall.
 *
 * `similarity` is `undefined` here — Phase 4 ranks by causal uplift only (see
 * module header). `utilityScore` collapses to `β·uplift` with α=γ=0 until the
 * vector leg is threaded.
 */
export interface CausalRecallHit {
  readonly id: string;
  readonly type: 'episode' | 'skill' | 'note' | 'fact';
  readonly content: string;
  readonly similarity?: number;
  readonly uplift: number;
  readonly causalConfidence: number;
  readonly utilityScore: number;
  readonly evidenceIds?: ReadonlyArray<string>;
  readonly mechanism?: string;
}

/** Row shape from the `causal_edges` table (agentdb-mcp-server.ts:137-153). */
interface CausalEdgeRow {
  readonly id: number;
  readonly from_memory_id: number;
  readonly from_memory_type: string;
  readonly to_memory_id: number;
  readonly to_memory_type: string;
  readonly similarity: number;
  readonly uplift: number;
  readonly confidence: number;
  readonly sample_size: number;
  readonly evidence_ids: string | null;
  readonly mechanism: string | null;
}

const CAUSAL_MEMORY_TYPES: ReadonlySet<string> = new Set(['episode', 'skill', 'note', 'fact']);

function narrowMemoryType(t: string): 'episode' | 'skill' | 'note' | 'fact' {
  if (!CAUSAL_MEMORY_TYPES.has(t)) {
    // Carve-out invariant: causal_edges.to_memory_type is one of four enum
    // values (CausalMemoryGraph.ts). An unknown value means the table
    // diverged from its schema — fail loud rather than silently bucket it
    // (`feedback-no-fallbacks`).
    throw new Error(
      `archivist: agentdb_causal_recall encountered unknown causal memory type '${t}' — ` +
        `causal_edges schema constrains this to episode|skill|note|fact`,
    );
  }
  return t as 'episode' | 'skill' | 'note' | 'fact';
}

function parseEvidence(raw: string | null): ReadonlyArray<string> | undefined {
  if (raw === null || raw === '') return undefined;
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(
      `archivist: agentdb_causal_recall evidence_ids must JSON-parse to an array, got ${typeof parsed}`,
    );
  }
  const out: string[] = [];
  for (const v of parsed) {
    if (typeof v !== 'string') {
      throw new Error('archivist: agentdb_causal_recall evidence_ids array must contain strings');
    }
    out.push(v);
  }
  return out;
}

export const causalRecallHandler: GuardedRead<AgentdbCausalRecallQuery, RankedResults<CausalRecallHit>> =
  registerReadHandler<AgentdbCausalRecallQuery, RankedResults<CausalRecallHit>>(
    'agentdb_causal_recall',
    async (ctx: ReadContext, payload: AgentdbCausalRecallQuery): Promise<RankedResults<CausalRecallHit>> => {
      const k = payload.k ?? 10;
      const minConfidence = payload.minConfidence ?? 0.6;
      const queryText = payload.query;

      // Substrate-native carve-out read: rank causal edges by (uplift,
      // confidence). `LIKE` against `mechanism` lets the query text steer the
      // candidate set toward edges whose causal mechanism mentions the query
      // — the cheapest text-relevance leg available without a vector index.
      // Edges without a mechanism string still match (the `mechanism IS NULL
      // OR …` clause) so a query against a freshly-populated table doesn't
      // silently return an empty set. Confidence and sample_size gate ADR-0033
      // `minConfidence` and the CausalMemoryGraph cold-start guard.
      //
      // ORDER BY uplift DESC, confidence DESC, sample_size DESC, id ASC: the
      // primary causal contribution wins (uplift), tie-broken by statistical
      // strength (confidence then sample_size), with a deterministic id tail
      // so identical-uplift edges have stable rank across calls. LIMIT caps at
      // `k` so the SQL planner can short-circuit.
      const rows = await ctx.substrate.query<CausalEdgeRow>({
        storeId: STORE_ID,
        predicate: {
          sql: `
            SELECT
              id, from_memory_id, from_memory_type,
              to_memory_id, to_memory_type,
              similarity, uplift, confidence, sample_size,
              evidence_ids, mechanism
            FROM causal_edges
            WHERE confidence >= @minConfidence
              AND (
                @likeQuery IS NULL
                OR mechanism IS NULL
                OR mechanism LIKE @likeQuery
              )
            ORDER BY uplift DESC, confidence DESC, sample_size DESC, id ASC
            LIMIT @limit
          `,
          params: {
            minConfidence,
            likeQuery: queryText.length > 0 ? `%${queryText}%` : null,
            limit: k,
          },
        },
      });

      return rows.map((row, index): RankedResult<CausalRecallHit> => {
        const type = narrowMemoryType(row.to_memory_type);
        const evidence = parseEvidence(row.evidence_ids);
        // utilityScore collapses to β·uplift with α=γ=0 in this Phase (see
        // module header). β defaults to 1.0 here so the score equals uplift
        // directly — preserves the cli `RerankCandidate.utilityScore` numeric
        // semantics for downstream `RankedResult.score` consumers.
        const utilityScore = row.uplift;
        return {
          item: {
            // The effect-side memory id is the candidate the causal edge
            // promotes; coerce to string for cross-store id semantics
            // (the cli's `RerankCandidate.id` field is `string`).
            id: String(row.to_memory_id),
            type,
            // Pre-rank handler has no content column on causal_edges — the
            // mechanism is the human-readable causal description, which is
            // the closest substrate-native content surrogate without joining
            // out to episodes/skills tables. Empty string when absent.
            content: row.mechanism ?? '',
            uplift: row.uplift,
            causalConfidence: row.confidence,
            utilityScore,
            evidenceIds: payload.includeEvidence ? evidence : undefined,
            mechanism: row.mechanism ?? undefined,
          },
          score: utilityScore,
          provenance: {
            storeId: 'causal_edges',
            // Rerank-merge of similarity + causal uplift would be `'fused'`
            // per the module-header design; this Phase ranks by causal
            // uplift alone, so the truthful matchType is `'semantic'` —
            // ranks reflect a single (causal) signal, not a fusion. Upgrades
            // to `'fused'` once a CausalRecall capability threads both legs.
            matchType: 'semantic',
            rawScore: row.uplift,
            rank: index + 1,
            matchedField: 'mechanism',
          },
        };
      });
    },
    { cacheScope: 'namespace' },
  );
