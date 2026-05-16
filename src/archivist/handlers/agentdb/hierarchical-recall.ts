// charter: dispatch
// agentdb_hierarchical_recall read handler (ADR-0180 Phase 6, §Architecture · Read-path
// return shape + §Provenance rollout scope).
//
// Recalls entries from the hierarchical memory store (working / episodic / semantic
// tiers — ADR-0140 / HierarchicalMemory controller) ranked by importance, with
// optional tier filter. Registers as `GuardedRead<AgentdbHierarchicalRecallQuery,
// RankedResults<HierarchicalRecallHit>>` so every candidate carries provenance
// verbatim (storeId='hierarchical:<tier>', matchType='semantic', rawScore, rank,
// matchedField='importance'). `matchType` stays `'semantic'` to preserve the
// existing Provenance union (`semantic | bm25 | exact | fused | status` —
// memory/search.ts:61) without a cross-cutting type widening; `matchedField`
// carries the honest rank signal so callers can distinguish importance-ordering
// from cosine reranking.
//
// ADR-0181 Phase 7 wire-up: the handler reads through `ctx.substrate.query` against
// the SQLite carve-out `hierarchical_memory` table (the same table AgentDB's
// `memory init` provisions and HierarchicalMemory.store writes into through
// the SQLite-classified `agentdb_hierarchical_store` write storeId). The
// `hierarchical_memory` schema (id TEXT, tier TEXT, content TEXT, importance
// REAL, created_at INTEGER, metadata TEXT — no embedding column) means
// importance is the canonical rank signal SQL-over-`hierarchical_memory` can
// expose; semantic reranking on this read path would require a sibling
// embedding table that does not exist in the current schema.
//
// Axis-flip safety verification (DA round 3 Refinement A):
// `controllers/HierarchicalMemory.ts:265-311` fires THREE writes per `store()`:
//   1. INSERT INTO hierarchical_memory   (always — relational/durable table)
//   2. vectorBackend.insert(...)         (when a VectorBackend is wired — RVF/HNSW)
//   3. INSERT INTO hmem_vec              (when ADR-0166 Phase 3 Option F is enabled —
//                                         the sqlite-vec virtual-table cosine k-NN mirror)
// Critically the writer fires (3) EXPLICITLY at L301 — there is no
// virtual-table auto-trigger from `hierarchical_memory` to `hmem_vec`. So the
// relational table this handler reads is unconditionally populated by every
// successful write; the axis-flip from `vectorSearch` to SQL does not orphan
// data on the durable side. What the flip DOES forfeit is the cosine k-NN
// signal the controller's own `recall(...)` reaches for first
// (HierarchicalMemory.ts:351-372) before falling back to manualSearch over
// the same relational rows. If a future caller needs k-NN-quality recall
// through this handler, the principled move is a sibling read storeId that
// dispatches into `hmem_vec` via a SQL `vec_search` call (Option F is on the
// same SQLite handle the substrate owns) — out of Phase 7 scope. Until then,
// importance ordering matches the cli's manualSearch fallback ordering.
//
// Runtime falsifier: if release acceptance trips skip-branch 4c (regex
// `no such table:` in `lib/acceptance-harness.sh::_expect_mcp_body`) on an
// `agentdb_hierarchical_recall` probe, the diagnosis is wrong — the SQLite
// substrate did not see `hierarchical_memory`. Pivot to dual-write would be
// the wrong fix in that case (the cli writer DOES populate the relational
// table); investigate substrate handle initialization order instead.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_hierarchical-recall` handler (line 501) — delegates to the package-level
// `hierarchicalRecall(...)` helper which calls `HierarchicalMemory.recall(...)`.
//
// Type-enforcement: `ctx.substrate` is read-only narrowing (`ReadContext`, no audit,
// no guard). Cache scope is `'global'` because the hierarchical store spans tiers
// rather than namespacing per-call — the tier filter is a payload field, not a
// cache partition.

import { registerReadHandler } from '../../registration.js';
import type { GuardedRead, ReadContext, StoreId } from '../../index.js';
import type { RankedResult, RankedResults } from '../memory/search.js';

export interface AgentdbHierarchicalRecallQuery {
  readonly query: string;
  readonly tier?: 'working' | 'episodic' | 'semantic';
  readonly topK?: number;
}

/**
 * Hierarchical-recall hit shape. Mirrors the underlying `hierarchicalRecall(...)`
 * helper's per-result shape (key + value + tier + score) so a dispatch-side flatten
 * back to legacy `{ results: [{ key, value, tier, score }] }` is a field-pick when
 * `includeProvenance: false`. `score` here is the row's `importance` value
 * (canonical rank signal — see file header).
 */
export interface HierarchicalRecallHit {
  readonly key: string;
  readonly value: unknown;
  readonly tier: 'working' | 'episodic' | 'semantic';
  readonly score: number;
}

const STORE_ID = 'agentdb_hierarchical_store' as StoreId;
const DEFAULT_TOP_K = 5;
const VALID_TIERS = new Set<HierarchicalRecallHit['tier']>(['working', 'episodic', 'semantic']);

/**
 * Row shape from the SELECT against `hierarchical_memory`. `metadata` is the
 * cli's stringified JSON envelope written by `HierarchicalMemory.store`
 * (typically `{ key }` plus any caller-supplied keys); `content` is the
 * stored value verbatim. `tier` is one of working/episodic/semantic but
 * arrives as raw `string` from SQL — `resolveTier` validates it.
 */
interface HierarchicalRow {
  readonly id: string;
  readonly content: string;
  readonly importance: number;
  readonly tier: string;
  readonly created_at: number;
  readonly metadata: string | null;
}

export const hierarchicalRecallHandler: GuardedRead<AgentdbHierarchicalRecallQuery, RankedResults<HierarchicalRecallHit>> =
  registerReadHandler<AgentdbHierarchicalRecallQuery, RankedResults<HierarchicalRecallHit>>(
    'agentdb_hierarchical_recall',
    async (ctx: ReadContext, payload: AgentdbHierarchicalRecallQuery): Promise<RankedResults<HierarchicalRecallHit>> => {
      const topK = payload.topK ?? DEFAULT_TOP_K;

      // Push the tier predicate down to SQL so the importance-ordered cursor
      // returns at most `topK` rows already-filtered. With no tier filter we
      // ask for `topK` rows and the rank-N hit IS the rank-N row.
      const where = payload.tier ? 'WHERE tier = @tier' : '';
      const params: Record<string, unknown> = { limit: topK };
      if (payload.tier) params.tier = payload.tier;

      const rows = await ctx.substrate.query<HierarchicalRow>({
        storeId: STORE_ID,
        predicate: {
          sql: `
            SELECT id, content, importance, tier, created_at, metadata
            FROM hierarchical_memory
            ${where}
            ORDER BY importance DESC
            LIMIT @limit
          `,
          params,
        },
      });

      // Build the ranked array from scratch (substrate-semantic immutability):
      // every per-hit field is built into a new HierarchicalRecallHit so the
      // substrate's returned objects are not aliased into the response.
      // Skip rows whose `tier` column failed validation (corrupt data) rather
      // than passing a synthetic tier — `feedback-no-fallbacks`.
      const ranked: RankedResult<HierarchicalRecallHit>[] = [];
      for (const row of rows) {
        const tier = resolveTier(row.tier);
        if (!tier) continue;
        const meta = parseMetadata(row.metadata, row.id);
        const key = typeof meta?.key === 'string' ? meta.key : row.id;
        const item: HierarchicalRecallHit = {
          key,
          value: row.content,
          tier,
          score: row.importance,
        };
        ranked.push({
          item,
          score: row.importance,
          provenance: {
            storeId: `hierarchical:${tier}`,
            matchType: 'semantic',
            rawScore: row.importance,
            rank: ranked.length + 1,
            matchedField: 'importance',
          },
        });
      }
      return ranked;
    },
    { cacheScope: 'global' },
  );

function resolveTier(raw: unknown): HierarchicalRecallHit['tier'] | undefined {
  if (typeof raw !== 'string') return undefined;
  return VALID_TIERS.has(raw as HierarchicalRecallHit['tier'])
    ? (raw as HierarchicalRecallHit['tier'])
    : undefined;
}

/**
 * Parse the `metadata` BLOB-as-TEXT column produced by HierarchicalMemory.store.
 * A malformed JSON envelope here means the writer contract diverged — fail
 * loud (`feedback-no-fallbacks`) so the caller sees the schema violation
 * instead of silently coercing to undefined and losing the `key` lookup.
 */
function parseMetadata(raw: string | null, rowId: string): Record<string, unknown> | undefined {
  if (raw === null || raw === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `archivist: agentdb_hierarchical_recall metadata for row '${rowId}' is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `archivist: agentdb_hierarchical_recall metadata for row '${rowId}' must JSON-parse to an object`,
    );
  }
  return parsed as Record<string, unknown>;
}
