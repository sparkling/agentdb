// charter: dispatch
// agentdb_reflexion_retrieve read handler (ADR-0180 Phase 6, §Architecture · Read-path
// return shape + §Provenance rollout scope).
//
// Reflexion recall is a ranked read — `ReflexionMemory.retrieveRelevant` returns
// episodes ordered by semantic similarity to the query task. Per ADR-0180
// §Provenance rollout scope, ranked reads MUST be able to surface provenance so
// downstream ExplainableRecall can attribute each hit to (storeId, matchType,
// rawScore, rank) without a second query. Legacy callers continue to receive the
// raw episode array (back-compat); provenance-aware callers pass
// `includeProvenance: true` at the cli boundary and receive `RankedResults<T>`.
//
// Substrate routing: per ADR-0181 Phase 4, reflexion episodes live in the
// SQLite carve-out (`episodes` + `episode_embeddings` tables —
// agentdb-mcp-server.ts:75-104). Episode metadata is SQL-addressed; the
// per-episode embedding is a BLOB stored alongside. This handler:
//   (a) embeds the query `task` via the narrow `EmbeddingScorer` capability;
//   (b) reads candidate (episode, embedding) pairs via `ctx.substrate.query`
//       with the cli's `onlyFailures` / `onlySuccesses` / `minReward` knobs
//       compiled into the WHERE clause (pre-filter pushed down to SQL — keeps
//       the JS-side cosine loop bounded);
//   (c) computes fresh cosine similarity for each candidate;
//   (d) ranks top-`k` and emits `RankedResult<ReflexionEpisodeHit>[]` with
//       provenance per episode.
//
// The fresh re-embed is the cli's behavior — `ReflexionMemory.retrieveRelevant`
// re-embeds the query against the live controller, so ranking reflects
// CURRENT semantic similarity, not the similarity captured at write time.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_reflexion_retrieve` handler (line 985) — delegates to the package-level
// `ReflexionMemory.retrieveRelevant({ task, k })`.
//
// CLI-TIER ALIGNMENT (DA round 2): `ReflexionMemory.retrieveRelevant`
// (controllers/ReflexionMemory.ts:241) is a 3-tier search — (1) GraphAdapter
// `searchSimilarEpisodes(qEmb, k*3)`, (2) VectorBackend HNSW
// `search(qEmb, k*3)`, (3) SQL fallback over `episodes ⨝ episode_embeddings`
// with per-row cosine (ReflexionMemory.ts:399, "Retrieve episodes using
// SQL-based similarity search (fallback)"). This handler ports the
// Tier 3 SQL path — the only tier that is (a) substrate-semantic for the
// SQLite carve-out (HNSW VectorBackend is RVF-family; reaching it from a
// SQLite-classified storeId would breach `classifyStore`'s family
// discipline) and (b) durable across the archivist dispatch boundary (the
// in-memory HNSW index is empty until `restoreFromDB()` rebuilds it). When
// large corpora arrive, threading a `VectorBackend` capability (parallel to
// `EmbeddingScorer`) is the Phase 9 inter-controller wiring move that adds
// HNSW prefilter — out of W4 scope.
//
// Type-enforcement: `ctx.substrate` is read-only narrowing (`ReadContext`, no
// audit, no guard). Per ADR-0180 §Read-path cache writes, this handler MAY
// populate in-memory caches (embedding cache for the query task) without
// invoking MutationGuard.

import { registerReadHandler } from '../../registration.js';
import type { GuardedRead, ReadContext, StoreId } from '../../index.js';
import type { RankedResult, RankedResults } from '../memory/search.js';

const STORE_ID = 'agentdb_reflexion_retrieve' as StoreId;
const DEFAULT_K = 5;
const FLOAT32_BYTES = 4;

/**
 * Input payload mirroring the CLI tool's `agentdb_reflexion_retrieve` input shape
 * (agentdb-tools.ts:988-1002) plus the underlying `ReflexionMemory.retrieveRelevant`
 * filter knobs (onlyFailures / onlySuccesses / minReward) that the CLI passes
 * positionally today.
 */
export interface AgentdbReflexionRetrieveQuery {
  readonly task: string;
  readonly k?: number;
  readonly onlyFailures?: boolean;
  readonly onlySuccesses?: boolean;
  readonly minReward?: number;
}

/**
 * Reflexion episode hit shape. Mirrors the `ReflexionMemory.retrieveRelevant`
 * return shape so a dispatch-side flatten back to the legacy episode array is
 * a field-pick when `includeProvenance: false`. `similarity` here is the
 * FRESH cosine score against the re-embedded query (not the write-time score),
 * preserving the cli's `retrieveRelevant` semantics.
 */
export interface ReflexionEpisodeHit {
  readonly id: number;
  readonly task: string;
  readonly reward: number;
  readonly success: boolean;
  readonly similarity: number;
  readonly critique?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Row shape from the SQL join over `episodes` and `episode_embeddings`
 * (agentdb-mcp-server.ts:75-104). `embedding` is a BLOB column —
 * `better-sqlite3` returns SQL BLOB values as Node `Buffer` instances.
 */
interface ReflexionEpisodeRow {
  readonly id: number;
  readonly task: string;
  readonly input: string | null;
  readonly output: string | null;
  readonly critique: string | null;
  readonly reward: number;
  readonly success: number;
  readonly metadata: string | null;
  readonly embedding: Buffer;
}

function parseJsonOrUndefined(raw: string | null): unknown {
  if (raw === null || raw === '') return undefined;
  // The cli's reflexion-store path JSON-stringifies `input`/`output`/`metadata`
  // before INSERT. A malformed JSON value here means the table diverged from
  // its writer contract — fail loud (`feedback-no-fallbacks`) so the caller
  // sees the schema violation instead of a silent `undefined`.
  return JSON.parse(raw);
}

function parseMetadata(raw: string | null): Record<string, unknown> | undefined {
  const parsed = parseJsonOrUndefined(raw);
  if (parsed === undefined) return undefined;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      'archivist: agentdb_reflexion_retrieve metadata must JSON-parse to an object',
    );
  }
  return parsed as Record<string, unknown>;
}

/**
 * Reconstruct a Float32Array view from the BLOB the cli's reflexion-store path
 * persists. The stored shape is `Buffer.from(float32.buffer)` — `byteLength`
 * must be a multiple of 4. Fail loud on a mismatch rather than silently
 * truncating (`feedback-no-fallbacks`).
 *
 * View-not-copy is safe with better-sqlite3 (DA round 2 empirical test):
 * `rows[i].b` returns row-unique Buffers whose underlying ArrayBuffer is also
 * row-unique (not `Buffer.allocUnsafePool`-shared) — mutation isolation
 * between rows verified. Matches the cli's own `retrieveSkillsLegacy`
 * (SkillLibrary.ts:362) which constructs the view the same way.
 */
function decodeEmbedding(buf: Buffer, episodeId: number): Float32Array {
  if (buf.byteLength % FLOAT32_BYTES !== 0) {
    throw new Error(
      `archivist: agentdb_reflexion_retrieve embedding for episode ${episodeId} ` +
        `has byteLength ${buf.byteLength} — must be a multiple of ${FLOAT32_BYTES}`,
    );
  }
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / FLOAT32_BYTES);
}

export const reflexionRetrieveHandler: GuardedRead<AgentdbReflexionRetrieveQuery, RankedResults<ReflexionEpisodeHit>> =
  registerReadHandler<AgentdbReflexionRetrieveQuery, RankedResults<ReflexionEpisodeHit>>(
    'agentdb_reflexion_retrieve',
    async (ctx: ReadContext, payload: AgentdbReflexionRetrieveQuery): Promise<RankedResults<ReflexionEpisodeHit>> => {
      const k = payload.k ?? DEFAULT_K;
      const embedder = ctx.capabilities.requireEmbeddingScorer();
      const queryVector = await embedder.embed(payload.task);

      // Compile filter knobs into the WHERE clause. Pushing onlyFailures /
      // onlySuccesses / minReward down to SQL keeps the JS-side cosine loop
      // bounded — a corpus of N episodes with M survivors after filter pays
      // O(M·dim) cosines, not O(N·dim).
      const whereClauses: string[] = [];
      if (payload.onlyFailures === true) whereClauses.push('e.success = 0');
      if (payload.onlySuccesses === true) whereClauses.push('e.success = 1');
      if (payload.minReward !== undefined) whereClauses.push('e.reward >= @minReward');
      const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const rows = await ctx.substrate.query<ReflexionEpisodeRow>({
        storeId: STORE_ID,
        predicate: {
          sql: `
            SELECT
              e.id, e.task, e.input, e.output, e.critique,
              e.reward, e.success, e.metadata,
              ee.embedding
            FROM episodes e
            INNER JOIN episode_embeddings ee ON ee.episode_id = e.id
            ${where}
          `,
          params: payload.minReward !== undefined ? { minReward: payload.minReward } : {},
        },
      });

      // Fresh-embedding cosine rerank — substrate-native, single pass.
      // `embedder.cosineSimilarity` throws on a dimension mismatch, which
      // surfaces a schema/embedding-model divergence loudly rather than
      // silently scoring at zero.
      const scored: ReadonlyArray<{ row: ReflexionEpisodeRow; similarity: number }> = rows.map((row) => ({
        row,
        similarity: embedder.cosineSimilarity(queryVector, decodeEmbedding(row.embedding, row.id)),
      }));

      const ranked = scored
        .slice()
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, k);

      return ranked.map(({ row, similarity }, index): RankedResult<ReflexionEpisodeHit> => ({
        item: {
          id: row.id,
          task: row.task,
          reward: row.reward,
          success: row.success === 1,
          similarity,
          critique: row.critique ?? undefined,
          input: parseJsonOrUndefined(row.input),
          output: parseJsonOrUndefined(row.output),
          metadata: parseMetadata(row.metadata),
        },
        score: similarity,
        provenance: {
          storeId: 'reflexion',
          matchType: 'semantic',
          rawScore: similarity,
          rank: index + 1,
          matchedField: 'task',
        },
      }));
    },
    { cacheScope: 'namespace' },
  );
