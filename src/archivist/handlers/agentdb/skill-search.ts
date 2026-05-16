// charter: dispatch
// agentdb_skill_search read handler (ADR-0180 Phase 6, §Architecture · Read-path
// return shape + §Provenance rollout scope).
//
// SkillLibrary recall is a ranked read — `SkillLibrary.retrieveSkills` (or its
// `searchSkills` / `search` fallback) returns reusable skills ordered by semantic
// similarity to the query task. Per ADR-0180 §Provenance rollout scope, ranked
// reads MUST be able to surface provenance so ExplainableRecall can attribute
// each hit to (storeId, matchType, rawScore, rank) without a second query.
// Legacy callers continue to receive the raw skill array (back-compat);
// provenance-aware callers pass `includeProvenance: true` at the cli boundary
// and receive `RankedResults<T>` verbatim.
//
// Substrate routing: per ADR-0181 Phase 4, skills live in the SQLite carve-out
// (`skills` + `skill_embeddings` tables — agentdb-mcp-server.ts:108-133).
// Skill metadata is SQL-addressed; the per-skill embedding is a BLOB stored
// alongside. This handler:
//   (a) embeds the query via the narrow `EmbeddingScorer` capability;
//   (b) reads (skill, embedding) pairs via `ctx.substrate.query` — the cli's
//       `retrieveSkills({ query, k })` had no metadata pre-filter, so no
//       WHERE clause here;
//   (c) computes fresh cosine similarity for each candidate;
//   (d) ranks top-`limit` and emits `RankedResult<SkillSearchHit>[]` with
//       provenance per hit.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_skill_search` handler (line 1687) — delegates to the SkillLibrary
// controller's `retrieveSkills({ query, k })` (with `searchSkills` / `search`
// fallbacks for older controller shapes).
//
// TRICHOTOMY COLLAPSE (DA round 3): the cli handler probes the SkillLibrary
// controller for three method shapes in order — `retrieveSkills({query,k})`
// (v2, the canonical shape), `searchSkills(query, limit)` (legacy positional),
// `search(query, limit)` (oldest). The trichotomy exists because the cli must
// support every controller version it might find at runtime. This archivist
// handler unifies on ONE path: a substrate-native SQL JOIN against `skills ⨝
// skill_embeddings` + fresh-embedding cosine — the same shape `retrieveSkills`
// v2's legacy tier walks (SkillLibrary.ts:334 `retrieveSkillsLegacy`). The
// collapse is defensible because the substrate seam is uniform: there is no
// "older controller" to dispatch to — the carve-out tables are the data, and
// the handler reads them directly. No information loss vs the cli trichotomy
// (every shape ultimately reads the same `skill_embeddings` BLOB column).
//
// CLI-TIER ALIGNMENT (DA round 2): `SkillLibrary.retrieveSkills`
// (controllers/SkillLibrary.ts:198) is a 3-tier search — (1) GraphAdapter
// `searchSkills(qEmb, k)`, (2) VectorBackend HNSW `search(qEmb, k*3)`, (3)
// `retrieveSkillsLegacy` SQL JOIN over `skills ⨝ skill_embeddings` with
// per-row cosine. Tier 2 falls through to Tier 3 on an empty in-memory index
// (SkillLibrary.ts:314-319: "VectorBackend is in-memory (no persistence
// path) — a fresh process sees an empty index. When the in-memory search
// yields nothing, fall back to the durable skill_embeddings table so
// cross-process skill retrieval still works"). This handler ports the
// Tier 3 legacy path verbatim — the only tier that (a) is substrate-semantic
// for the SQLite carve-out (the HNSW VectorBackend is RVF-family, not
// SQLite-carve-out — accessing it from a SQLite-classified storeId would
// breach `classifyStore`'s family discipline) and (b) is durable across the
// archivist dispatch boundary (a cross-process surface that cannot rely on
// an in-memory HNSW instance). When 100k+ corpora arrive, threading a
// `VectorBackend` capability (parallel to `EmbeddingScorer`) is the Phase 9
// inter-controller wiring move that adds HNSW prefilter — that is NOT a W4
// scope.
//
// Type-enforcement: `ctx.substrate` is read-only narrowing (`ReadContext`, no
// audit, no guard). Per ADR-0180 §Read-path cache writes, this handler MAY
// populate in-memory caches (embedding cache for the query task) without
// invoking MutationGuard — those writes die with the process and are reflected
// in `ctx.cacheHints.wrote_cache` as advisory observability.

import { registerReadHandler } from '../../registration.js';
import type { GuardedRead, ReadContext, StoreId } from '../../index.js';
import type { RankedResult, RankedResults } from '../memory/search.js';

const STORE_ID = 'agentdb_skill_search' as StoreId;
const DEFAULT_LIMIT = 5;
const FLOAT32_BYTES = 4;

/**
 * Input payload mirroring the CLI tool's `agentdb_skill_search` input shape
 * (agentdb-tools.ts:1690-1703). `query` / `limit` are the SkillLibrary-side
 * names the cli handler validates and forwards; this archivist handler accepts
 * the same surface so the dispatch boundary can be wired without a second
 * schema translation.
 */
export interface AgentdbSkillSearchQuery {
  readonly query: string;
  readonly limit?: number;
}

/**
 * Skill hit shape. Mirrors the SkillLibrary controller's `retrieveSkills`
 * return shape (`{ id, name, description, successRate, ... }` per hit). The
 * flat shape pick for `includeProvenance: false` is a field-pick at the
 * dispatch boundary.
 */
export interface SkillSearchHit {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  readonly successRate: number;
  readonly uses: number;
  readonly avgReward: number;
  readonly avgLatencyMs: number;
  readonly code?: string;
  readonly signature?: unknown;
  readonly metadata?: Record<string, unknown>;
  readonly similarity: number;
}

/**
 * Row shape from the SQL join over `skills` and `skill_embeddings`
 * (agentdb-mcp-server.ts:108-133). `description` may be NULL per the column
 * definition; `signature` and `metadata` are JSON strings; `embedding` is a
 * BLOB column — `better-sqlite3` returns SQL BLOB values as Node `Buffer`.
 */
interface SkillRow {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly signature: string | null;
  readonly code: string | null;
  readonly success_rate: number;
  readonly uses: number;
  readonly avg_reward: number;
  readonly avg_latency_ms: number;
  readonly metadata: string | null;
  readonly embedding: Buffer;
}

function parseJsonOrUndefined(raw: string | null): unknown {
  if (raw === null || raw === '') return undefined;
  return JSON.parse(raw);
}

function parseMetadata(raw: string | null): Record<string, unknown> | undefined {
  const parsed = parseJsonOrUndefined(raw);
  if (parsed === undefined) return undefined;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      'archivist: agentdb_skill_search metadata must JSON-parse to an object',
    );
  }
  return parsed as Record<string, unknown>;
}

/**
 * Reconstruct a Float32Array view from the cli's stored embedding BLOB.
 *
 * View-not-copy is safe with better-sqlite3 (DA round 2 empirical test):
 * `rows[i].b` returns row-unique Buffers whose underlying ArrayBuffer is also
 * row-unique (not `Buffer.allocUnsafePool`-shared) — mutation isolation
 * between rows verified. Matches the cli's own `retrieveSkillsLegacy`
 * (SkillLibrary.ts:362) which constructs the view the same way.
 */
function decodeEmbedding(buf: Buffer, skillId: number): Float32Array {
  if (buf.byteLength % FLOAT32_BYTES !== 0) {
    throw new Error(
      `archivist: agentdb_skill_search embedding for skill ${skillId} ` +
        `has byteLength ${buf.byteLength} — must be a multiple of ${FLOAT32_BYTES}`,
    );
  }
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / FLOAT32_BYTES);
}

export const skillSearchHandler: GuardedRead<AgentdbSkillSearchQuery, RankedResults<SkillSearchHit>> =
  registerReadHandler<AgentdbSkillSearchQuery, RankedResults<SkillSearchHit>>(
    'agentdb_skill_search',
    async (ctx: ReadContext, payload: AgentdbSkillSearchQuery): Promise<RankedResults<SkillSearchHit>> => {
      const limit = payload.limit ?? DEFAULT_LIMIT;
      const embedder = ctx.capabilities.requireEmbeddingScorer();
      const queryVector = await embedder.embed(payload.query);

      const rows = await ctx.substrate.query<SkillRow>({
        storeId: STORE_ID,
        predicate: {
          sql: `
            SELECT
              s.id, s.name, s.description, s.signature, s.code,
              s.success_rate, s.uses, s.avg_reward, s.avg_latency_ms,
              s.metadata,
              se.embedding
            FROM skills s
            INNER JOIN skill_embeddings se ON se.skill_id = s.id
          `,
        },
      });

      // Fresh-embedding cosine rerank — substrate-native, single pass.
      // `embedder.cosineSimilarity` throws on a dimension mismatch, surfacing
      // a schema/embedding-model divergence loudly rather than silently
      // scoring at zero.
      const scored: ReadonlyArray<{ row: SkillRow; similarity: number }> = rows.map((row) => ({
        row,
        similarity: embedder.cosineSimilarity(queryVector, decodeEmbedding(row.embedding, row.id)),
      }));

      const ranked = scored
        .slice()
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      return ranked.map(({ row, similarity }, index): RankedResult<SkillSearchHit> => ({
        item: {
          id: row.id,
          name: row.name,
          description: row.description ?? '',
          successRate: row.success_rate,
          uses: row.uses,
          avgReward: row.avg_reward,
          avgLatencyMs: row.avg_latency_ms,
          code: row.code ?? undefined,
          signature: parseJsonOrUndefined(row.signature),
          metadata: parseMetadata(row.metadata),
          similarity,
        },
        score: similarity,
        provenance: {
          storeId: 'skills',
          matchType: 'semantic',
          rawScore: similarity,
          rank: index + 1,
          matchedField: 'name',
        },
      }));
    },
    { cacheScope: 'namespace' },
  );
