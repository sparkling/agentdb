/**
 * ReflexionMemory - Episodic Replay Memory System
 *
 * Implements reflexion-style episodic replay for agent self-improvement.
 * Stores self-critiques and outcomes, retrieves relevant past experiences.
 *
 * Based on: "Reflexion: Language Agents with Verbal Reinforcement Learning"
 * https://arxiv.org/abs/2303.11366
 *
 * ADR-0170 Phase B.2:
 *   - SQL ported to PostgreSQL dialect (BIGSERIAL, BYTEA, $N placeholders,
 *     EXTRACT EPOCH, ON CONFLICT, BOOLEAN).
 *   - Constructor accepts a `PostgresBackend` handle directly (no more
 *     `IDatabaseConnection` / better-sqlite3 abstraction).
 *   - SQLite-specific paths removed: the `reflexion_episode_vec` Option F
 *     mirror writes, the `detectOptionF` probe, and the sql.js/better-sqlite3
 *     prepare/run/get/all surface are gone.
 *   - The `@ruvector/graph-node` Cypher branch is removed (see resolution J):
 *     `graphBackend` param dropped, `createEpisodeGraphNode` deleted, the
 *     `retrieveFromGraphAdapter`/`retrieveFromGenericGraph` strategies
 *     removed, the Cypher queries in `getEpisodeRelationships` and prior-
 *     failures lookups replaced with SQL.
 *
 * ADR-0170 Phase C.1 (2026-05-12):
 *   - `episode_embeddings.embedding` is now `vector(768)` (was BYTEA).
 *   - HNSW index `idx_episode_embeddings_hnsw` accelerates k-NN.
 *   - `vectorBackend.insert(...)` parallel-write path retired; SQL row +
 *     pgvector HNSW index are the index of record.
 *   - `retrieveFromSQLFallback` rewritten as `retrieveViaPgvector` —
 *     `ORDER BY embedding <=> $1::vector LIMIT $k`, no JS-side cosine.
 *   - GNN enhancement helper switched to a SELECT against pgvector +
 *     learning backend; no more in-memory accelerator path.
 */

import { EmbeddingService } from './EmbeddingService.js';
import type { VectorBackend } from '../backends/VectorBackend.js';
import type { LearningBackend } from '../backends/LearningBackend.js';
import type { PostgresBackend } from '../backends/postgres/PostgresBackend.js';
import { embeddingToVector, vectorToEmbedding } from '../backends/postgres/PostgresBackend.js';
import { QueryCache, type QueryCacheConfig } from '../core/QueryCache.js';

export interface Episode {
  id?: number;
  ts?: number;
  sessionId: string;
  task: string;
  input?: string;
  output?: string;
  critique?: string;
  reward: number;
  success: boolean;
  latencyMs?: number;
  tokensUsed?: number;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface EpisodeWithEmbedding extends Episode {
  embedding?: Float32Array;
  similarity?: number;
}

export interface ReflexionQuery {
  task: string;
  currentState?: string;
  k?: number; // Top-k to retrieve
  minReward?: number;
  onlyFailures?: boolean;
  onlySuccesses?: boolean;
  timeWindowDays?: number;
}

interface EpisodeRow {
  id: number | bigint | string;
  ts: number | bigint | string;
  session_id: string;
  task: string;
  input: string | null;
  output: string | null;
  critique: string | null;
  reward: number;
  success: boolean;
  latency_ms: number | bigint | null;
  tokens_used: number | bigint | null;
  tags: string | null;
  metadata: any;
}

// ADR-0076 A4: Dual-instance guard — prevent duplicate construction
// when both ControllerRegistry and AgentDBService create this controller.
let _singleton: InstanceType<typeof ReflexionMemory> | null = null;

export class ReflexionMemory {
  private db!: PostgresBackend;
  private embedder!: EmbeddingService;
  private vectorBackend?: VectorBackend;
  private learningBackend?: LearningBackend;
  private queryCache!: QueryCache;
  private ready!: Promise<void>;

  static _resetSingleton(): void { _singleton = null; }

  constructor(
    db: PostgresBackend,
    embedder: EmbeddingService,
    vectorBackend?: VectorBackend,
    learningBackend?: LearningBackend,
    cacheConfig?: QueryCacheConfig
  ) {
    if (_singleton) {
      if (process.env.CLAUDE_FLOW_DEBUG) {
        console.warn(`[${this.constructor.name}] Duplicate construction detected — returning existing instance`);
      }
      return _singleton as any;
    }
    _singleton = this;
    this.db = db;
    this.embedder = embedder;
    this.vectorBackend = vectorBackend;
    this.learningBackend = learningBackend;
    this.queryCache = new QueryCache(cacheConfig);

    // ADR-0090 B5: idempotent schema bootstrap. Postgres-dialect DDL,
    // identical shape to schemas/schema.sql episodes + episode_embeddings.
    // Constructors can't be async, so we expose a `ready` promise that
    // every public method awaits.
    this.ready = this.bootstrapSchema();
  }

  private async bootstrapSchema(): Promise<void> {
    // ADR-0170 Phase C.1: episode_embeddings.embedding is `vector(768)`
    // (was BYTEA in Phase B). HNSW index uses cosine ops at m=23,
    // ef_construction=100 per memory `reference-embedding-model`.
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        id BIGSERIAL PRIMARY KEY,
        ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        session_id TEXT NOT NULL,
        task TEXT NOT NULL,
        input TEXT,
        output TEXT,
        critique TEXT,
        reward REAL DEFAULT 0.0,
        success BOOLEAN DEFAULT FALSE,
        latency_ms BIGINT,
        tokens_used BIGINT,
        tags TEXT,
        metadata JSONB,
        created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      );
      CREATE INDEX IF NOT EXISTS idx_episodes_ts ON episodes(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id);
      CREATE INDEX IF NOT EXISTS idx_episodes_reward ON episodes(reward DESC);
      CREATE INDEX IF NOT EXISTS idx_episodes_task ON episodes(task);
      CREATE TABLE IF NOT EXISTS episode_embeddings (
        episode_id BIGINT PRIMARY KEY,
        embedding vector(768) NOT NULL,
        embedding_model TEXT DEFAULT 'Xenova/all-mpnet-base-v2',
        FOREIGN KEY(episode_id) REFERENCES episodes(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_episode_embeddings_hnsw
        ON episode_embeddings
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 23, ef_construction = 100);
    `);
  }

  /**
   * Store a new episode with its critique and outcome
   */
  async storeEpisode(episode: Episode): Promise<number> {
    await this.ready;

    // Invalidate episode caches on write
    this.queryCache.invalidateCategory('episodes');
    this.queryCache.invalidateCategory('task-stats');

    const tags = episode.tags ? JSON.stringify(episode.tags) : null;
    const metadata = episode.metadata ? JSON.stringify(episode.metadata) : null;

    const insertResult = await this.db.query(
      `INSERT INTO episodes (
        session_id, task, input, output, critique, reward, success,
        latency_ms, tokens_used, tags, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [
        episode.sessionId,
        episode.task,
        episode.input ?? null,
        episode.output ?? null,
        episode.critique ?? null,
        episode.reward,
        episode.success,
        episode.latencyMs ?? null,
        episode.tokensUsed ?? null,
        tags,
        metadata,
      ]
    );

    const episodeId = toNumber((insertResult.rows[0] as { id: number | bigint | string }).id);

    // Generate and store embedding
    const text = this.buildEpisodeText(episode);
    const embedding = await this.embedder.embed(text);

    // ADR-0170 Phase C.1: pgvector column is the index of record. No
    // parallel `vectorBackend.insert(...)` — the HNSW index on
    // episode_embeddings.embedding handles k-NN.
    await this.storeEmbedding(episodeId, embedding);

    // Feed learning backend if wired
    if (this.learningBackend && episode.success !== undefined) {
      this.learningBackend.addSample({
        embedding,
        label: episode.success ? 1 : 0,
        weight: Math.abs(episode.reward),
        context: {
          task: episode.task,
          sessionId: episode.sessionId,
          latencyMs: episode.latencyMs,
          tokensUsed: episode.tokensUsed,
        },
      });
    }

    return episodeId;
  }

  /**
   * Retrieve relevant past episodes for a new task attempt
   * Results are cached for improved performance
   */
  async retrieveRelevant(query: ReflexionQuery): Promise<EpisodeWithEmbedding[]> {
    await this.ready;

    const {
      task,
      currentState = '',
      k = 5,
      minReward,
      onlyFailures = false,
      onlySuccesses = false,
      timeWindowDays,
    } = query;

    const cacheKey = this.queryCache.generateKey(
      'retrieveRelevant',
      [task, currentState, k, minReward, onlyFailures, onlySuccesses, timeWindowDays],
      'episodes'
    );

    const cached = this.queryCache.get<EpisodeWithEmbedding[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const queryEmbedding = await this.prepareQueryEmbedding(task, currentState, k);

    // ADR-0170 Phase C.1: pgvector HNSW is the only k-NN path. The
    // legacy in-memory accelerator dichotomy is retired — there's no
    // separate "vectorBackend" or "SQL fallback" branch.
    const episodes = await this.retrieveViaPgvector(queryEmbedding, query);

    this.queryCache.set(cacheKey, episodes);
    return episodes;
  }

  /**
   * Prepare and enhance query embedding for search
   */
  private async prepareQueryEmbedding(
    task: string,
    currentState: string,
    k: number
  ): Promise<Float32Array> {
    const queryText = currentState ? `${task}\n${currentState}` : task;
    let queryEmbedding = await this.embedder.embed(queryText);

    if (this.learningBackend) {
      queryEmbedding = await this.enhanceQueryWithGNN(queryEmbedding, k);
    }

    return queryEmbedding;
  }

  /**
   * Retrieve episodes via pgvector HNSW k-NN.
   *
   * ADR-0170 Phase C.1: replaces both `retrieveFromVectorBackend` and
   * `retrieveFromSQLFallback`. Postgres picks the HNSW index automatically
   * when ORDER BY uses the `<=>` operator on a pgvector column.
   *
   * Cosine distance via `<=>`: 0 = identical, 2 = opposite. We convert to
   * similarity = 1 - distance.
   */
  private async retrieveViaPgvector(
    queryEmbedding: Float32Array,
    query: ReflexionQuery
  ): Promise<EpisodeWithEmbedding[]> {
    const { k = 5, minReward, onlyFailures, onlySuccesses, timeWindowDays } = query;

    // Filters go in WHERE; the ORDER BY is the k-NN driver. $1 is the
    // query vector, $2..$N are filter values.
    const filters: string[] = [];
    const params: unknown[] = [embeddingToVector(queryEmbedding)];
    let nextParam = 2;

    if (minReward !== undefined) {
      filters.push(`e.reward >= $${nextParam++}`);
      params.push(minReward);
    }
    if (onlyFailures) filters.push('e.success = FALSE');
    if (onlySuccesses) filters.push('e.success = TRUE');
    if (timeWindowDays) {
      filters.push(`e.ts > EXTRACT(EPOCH FROM NOW())::BIGINT - $${nextParam++}`);
      params.push(timeWindowDays * 86400);
    }
    params.push(k);
    const limitParam = nextParam;
    const whereClause = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';

    const result = await this.db.query(
      `SELECT e.*,
              ee.embedding <=> $1::vector AS distance
       FROM episodes e
       JOIN episode_embeddings ee ON e.id = ee.episode_id
       WHERE ee.embedding IS NOT NULL ${whereClause}
       ORDER BY ee.embedding <=> $1::vector
       LIMIT $${limitParam}`,
      params
    );

    const rows = result.rows as Array<EpisodeRow & { distance: number }>;
    return rows.map((row) => {
      const similarity = 1 - Number(row.distance);
      return this.convertDatabaseEpisode(row, similarity);
    });
  }

  /**
   * Convert database row to EpisodeWithEmbedding
   */
  private convertDatabaseEpisode(
    row: EpisodeRow,
    similarity?: number,
    embedding?: Float32Array
  ): EpisodeWithEmbedding {
    return {
      id: toNumber(row.id),
      ts: toNumber(row.ts),
      sessionId: row.session_id,
      task: row.task,
      input: row.input ?? undefined,
      output: row.output ?? undefined,
      critique: row.critique ?? undefined,
      reward: row.reward,
      success: row.success === true,
      latencyMs: row.latency_ms !== null ? toNumber(row.latency_ms) : undefined,
      tokensUsed: row.tokens_used !== null ? toNumber(row.tokens_used) : undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : undefined,
      embedding,
      similarity,
    };
  }

  /**
   * Get statistics for a task (cached)
   */
  async getTaskStats(
    task: string,
    timeWindowDays?: number
  ): Promise<{
    totalAttempts: number;
    successRate: number;
    avgReward: number;
    avgLatency: number;
    improvementTrend: number;
  }> {
    await this.ready;

    const cacheKey = this.queryCache.generateKey(
      'getTaskStats',
      [task, timeWindowDays],
      'task-stats'
    );

    const cached = this.queryCache.get<{
      totalAttempts: number;
      successRate: number;
      avgReward: number;
      avgLatency: number;
      improvementTrend: number;
    }>(cacheKey);
    if (cached) return cached;

    const params: any[] = [task];
    let windowFilter = '';
    if (timeWindowDays !== undefined) {
      windowFilter = `AND ts > EXTRACT(EPOCH FROM NOW())::BIGINT - $2`;
      params.push(timeWindowDays * 86400);
    }

    const statsResult = await this.db.query(
      `SELECT
        COUNT(*) AS total,
        AVG(CASE WHEN success = TRUE THEN 1.0 ELSE 0.0 END) AS success_rate,
        AVG(reward) AS avg_reward,
        AVG(latency_ms) AS avg_latency
      FROM episodes
      WHERE task = $1 ${windowFilter}`,
      params
    );
    const statsRow = (statsResult.rows[0] as any) ?? {};

    const trendParams: any[] = [task];
    let trendWindowFilter = '';
    if (timeWindowDays !== undefined) {
      trendWindowFilter = `AND ts > EXTRACT(EPOCH FROM NOW())::BIGINT - $2`;
      trendParams.push(timeWindowDays * 86400);
    }

    const trendResult = await this.db.query(
      `SELECT
        AVG(CASE
          WHEN ts > EXTRACT(EPOCH FROM NOW())::BIGINT - ${7 * 86400} THEN reward
        END) AS recent_reward,
        AVG(CASE
          WHEN ts <= EXTRACT(EPOCH FROM NOW())::BIGINT - ${7 * 86400} THEN reward
        END) AS older_reward
      FROM episodes
      WHERE task = $1 ${trendWindowFilter}`,
      trendParams
    );
    const trendRow = (trendResult.rows[0] as any) ?? {};
    const recentReward = trendRow.recent_reward != null ? Number(trendRow.recent_reward) : null;
    const olderReward = trendRow.older_reward != null ? Number(trendRow.older_reward) : null;
    const improvementTrend =
      recentReward != null && olderReward != null && olderReward !== 0
        ? (recentReward - olderReward) / olderReward
        : 0;

    const results = {
      totalAttempts: statsRow.total != null ? Number(statsRow.total) : 0,
      successRate: statsRow.success_rate != null ? Number(statsRow.success_rate) : 0,
      avgReward: statsRow.avg_reward != null ? Number(statsRow.avg_reward) : 0,
      avgLatency: statsRow.avg_latency != null ? Number(statsRow.avg_latency) : 0,
      improvementTrend,
    };

    this.queryCache.set(cacheKey, results);
    return results;
  }

  /**
   * Build critique summary from similar failed episodes (cached)
   */
  async getCritiqueSummary(query: ReflexionQuery): Promise<string> {
    const cacheKey = this.queryCache.generateKey(
      'getCritiqueSummary',
      [query.task, query.k],
      'episodes'
    );

    const cached = this.queryCache.get<string>(cacheKey);
    if (cached) return cached;

    const failures = await this.retrieveRelevant({
      ...query,
      onlyFailures: true,
      k: 3,
    });

    if (failures.length === 0) {
      return 'No prior failures found for this task.';
    }

    const critiques = failures
      .filter((ep) => ep.critique)
      .map((ep, i) => `${i + 1}. ${ep.critique} (reward: ${ep.reward.toFixed(2)})`)
      .join('\n');

    const result = `Prior failures and lessons learned:\n${critiques}`;
    this.queryCache.set(cacheKey, result);
    return result;
  }

  /**
   * Get successful strategies for a task (cached)
   */
  async getSuccessStrategies(query: ReflexionQuery): Promise<string> {
    const cacheKey = this.queryCache.generateKey(
      'getSuccessStrategies',
      [query.task, query.k],
      'episodes'
    );

    const cached = this.queryCache.get<string>(cacheKey);
    if (cached) return cached;

    const successes = await this.retrieveRelevant({
      ...query,
      onlySuccesses: true,
      minReward: 0.7,
      k: 3,
    });

    if (successes.length === 0) {
      return 'No successful strategies found for this task.';
    }

    const strategies = successes
      .map((ep, i) => {
        const approach = ep.output?.substring(0, 200) || 'No output recorded';
        return `${i + 1}. Approach (reward ${ep.reward.toFixed(2)}): ${approach}...`;
      })
      .join('\n');

    const result = `Successful strategies:\n${strategies}`;
    this.queryCache.set(cacheKey, result);
    return result;
  }

  /**
   * Get recent episodes for a session
   */
  async getRecentEpisodes(sessionId: string, limit: number = 10): Promise<Episode[]> {
    await this.ready;

    const result = await this.db.query(
      `SELECT * FROM episodes
       WHERE session_id = $1
       ORDER BY ts DESC
       LIMIT $2`,
      [sessionId, limit]
    );

    return (result.rows as EpisodeRow[]).map((row) => ({
      id: toNumber(row.id),
      ts: toNumber(row.ts),
      sessionId: row.session_id,
      task: row.task,
      input: row.input ?? undefined,
      output: row.output ?? undefined,
      critique: row.critique ?? undefined,
      reward: row.reward,
      success: row.success === true,
      latencyMs: row.latency_ms !== null ? toNumber(row.latency_ms) : undefined,
      tokensUsed: row.tokens_used !== null ? toNumber(row.tokens_used) : undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : undefined,
    }));
  }

  /**
   * Prune low-quality episodes based on TTL and quality threshold.
   * Returns the number of episodes removed.
   */
  async pruneEpisodes(config: {
    minReward?: number;
    maxAgeDays?: number;
    keepMinPerTask?: number;
  }): Promise<number> {
    await this.ready;

    const { minReward = 0.3, maxAgeDays = 30, keepMinPerTask = 5 } = config;

    // Postgres window-function subquery, structurally identical to the
    // SQLite original. Note the additional CTE-style aliasing required
    // by postgres (subqueries returning multiple columns need a name).
    const result = await this.db.query(
      `DELETE FROM episodes
       WHERE id IN (
         SELECT id FROM (
           SELECT
             id,
             reward,
             ts,
             ROW_NUMBER() OVER (PARTITION BY task ORDER BY reward DESC) AS rnk
           FROM episodes
           WHERE reward < $1
             AND ts < EXTRACT(EPOCH FROM NOW())::BIGINT - $2
         ) ranked WHERE rnk > $3
       )`,
      [minReward, maxAgeDays * 86400, keepMinPerTask]
    );

    const changes = (result as any).rowCount ?? 0;
    if (changes > 0) {
      this.queryCache.invalidateCategory('episodes');
      this.queryCache.invalidateCategory('task-stats');
    }

    return changes;
  }

  // ========================================================================
  // Private Helper Methods
  // ========================================================================

  private buildEpisodeText(episode: Episode): string {
    const parts = [episode.task];
    if (episode.critique) parts.push(episode.critique);
    if (episode.output) parts.push(episode.output);
    return parts.join('\n');
  }

  /**
   * Store an episode's embedding as a pgvector value.
   *
   * ADR-0170 Phase C.1: column is `vector(768)`; we pass the text
   * literal `[v1,v2,…]` cast to `vector`. Both pglite and node-postgres
   * accept this format transparently.
   */
  private async storeEmbedding(episodeId: number, embedding: Float32Array): Promise<void> {
    await this.db.query(
      `INSERT INTO episode_embeddings (episode_id, embedding)
       VALUES ($1, $2::vector)
       ON CONFLICT (episode_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
      [episodeId, embeddingToVector(embedding)]
    );
  }

  // ========================================================================
  // GNN integration (in-process; no graph backend involved)
  // ========================================================================

  /**
   * Enhance query embedding using GNN attention mechanism.
   *
   * ADR-0170 Phase C.1: pgvector HNSW finds the neighbors directly; the
   * in-memory accelerator path is retired. We pull both the embedding
   * column (now `vector(768)`) and the reward in one query and feed
   * neighbor embeddings to the learning backend's enhance() method.
   */
  private async enhanceQueryWithGNN(
    queryEmbedding: Float32Array,
    k: number
  ): Promise<Float32Array> {
    if (!this.learningBackend) {
      return queryEmbedding;
    }

    try {
      const result = await this.db.query(
        `SELECT ee.embedding, e.reward
         FROM episode_embeddings ee
         JOIN episodes e ON e.id = ee.episode_id
         WHERE ee.embedding IS NOT NULL
         ORDER BY ee.embedding <=> $1::vector
         LIMIT $2`,
        [embeddingToVector(queryEmbedding), k * 2]
      );

      const neighborEmbeddings: Float32Array[] = [];
      const weights: number[] = [];
      for (const ep of result.rows as Array<{ embedding: unknown; reward: number }>) {
        neighborEmbeddings.push(vectorToEmbedding(ep.embedding));
        weights.push(Math.max(0.1, ep.reward));
      }

      if (neighborEmbeddings.length === 0) return queryEmbedding;
      return this.learningBackend.enhance(queryEmbedding, neighborEmbeddings, weights);
    } catch (error) {
      console.warn('[ReflexionMemory] GNN enhancement failed:', error);
      return queryEmbedding;
    }
  }

  /**
   * Get SQL-derived episode relationships for an episode. Replaces the
   * Cypher `MATCH ... OPTIONAL MATCH ...` graph traversal with a session
   * + reward proximity SQL lookup.
   *
   * `similar` is determined by cosine similarity over episode_embeddings
   * (limited to the same session for relevance); `learnedFrom` lists prior
   * failures in the same session that this episode might be a reflection
   * of (per Reflexion's causal-failure pattern).
   */
  async getEpisodeRelationships(episodeId: number): Promise<{
    similar: number[];
    session: string;
    learnedFrom: number[];
  }> {
    await this.ready;

    const epResult = await this.db.query(
      `SELECT id, session_id, ts FROM episodes WHERE id = $1`,
      [episodeId]
    );
    if (epResult.rows.length === 0) {
      return { similar: [], session: '', learnedFrom: [] };
    }
    const ep = epResult.rows[0] as { id: number | bigint | string; session_id: string; ts: number | bigint | string };

    const similarResult = await this.db.query(
      `SELECT id FROM episodes
       WHERE session_id = $1 AND id <> $2
       ORDER BY ABS(ts - $3) ASC
       LIMIT 5`,
      [ep.session_id, episodeId, toNumber(ep.ts)]
    );
    const similar = (similarResult.rows as Array<{ id: number | bigint | string }>).map((r) => toNumber(r.id));

    const learnedResult = await this.db.query(
      `SELECT id FROM episodes
       WHERE session_id = $1 AND success = FALSE AND ts < $2
       ORDER BY ts DESC
       LIMIT 3`,
      [ep.session_id, toNumber(ep.ts)]
    );
    const learnedFrom = (learnedResult.rows as Array<{ id: number | bigint | string }>).map((r) => toNumber(r.id));

    return { similar, session: ep.session_id, learnedFrom };
  }

  /**
   * Train GNN model on accumulated samples
   */
  async trainGNN(options?: { epochs?: number }): Promise<void> {
    if (!this.learningBackend) {
      console.warn('[ReflexionMemory] No learning backend available for training');
      return;
    }

    const stats = this.learningBackend.getStats();
    if (stats.samplesCollected < 10) {
      console.warn('[ReflexionMemory] Not enough samples for training (need at least 10)');
      return;
    }

    const result = await this.learningBackend.train(options);
    console.log('[ReflexionMemory] GNN training complete:', {
      epochs: result.epochs,
      finalLoss: result.finalLoss.toFixed(4),
      improvement: `${(result.improvement * 100).toFixed(1)}%`,
      duration: `${result.duration}ms`,
    });
  }

  /**
   * Get learning backend statistics
   */
  getLearningStats() {
    if (!this.learningBackend) {
      return null;
    }
    return this.learningBackend.getStats();
  }

  /**
   * Get query cache statistics
   */
  getCacheStats() {
    return this.queryCache.getStatistics();
  }

  /**
   * Clear query cache
   */
  clearCache(): void {
    this.queryCache.clear();
  }

  /**
   * Prune expired cache entries
   */
  pruneCache(): number {
    return this.queryCache.pruneExpired();
  }

  /**
   * Warm cache with common queries
   */
  async warmCache(sessionId?: string): Promise<void> {
    await this.queryCache.warm(async (_cache) => {
      if (sessionId) {
        await this.getRecentEpisodes(sessionId, 10);
      }
    });
  }

  /**
   * Delete an episode by id.
   *
   * Removes the SQL `episodes` and `episode_embeddings` rows (FK CASCADE
   * handles the latter when present, but we issue both deletes for
   * defence-in-depth across drivers). Also clears the vector-backend
   * accelerator entry when wired.
   */
  async deleteEpisode(id: number | string): Promise<boolean> {
    await this.ready;

    const numericId = typeof id === 'number' ? id : parseInt(String(id), 10);

    this.queryCache.invalidateCategory('episodes');
    this.queryCache.invalidateCategory('task-stats');

    let removed = false;

    // ADR-0170 Phase C.1: no separate vector index — DELETE removes the
    // pgvector HNSW entry along with the row. ON DELETE CASCADE on
    // episode_embeddings handles the embedding row too, but we issue
    // both deletes for defence-in-depth across drivers.
    if (Number.isFinite(numericId)) {
      try {
        await this.db.query(`DELETE FROM episode_embeddings WHERE episode_id = $1`, [numericId]);
        const r = await this.db.query(`DELETE FROM episodes WHERE id = $1`, [numericId]);
        const changes = (r as any).rowCount ?? 0;
        if (changes > 0) removed = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[ReflexionMemory] deleteEpisode: SQL delete failed: ${msg}`);
      }
    }

    return removed;
  }

  /**
   * Rebuild the pgvector index for episodes from scratch.
   *
   * ADR-0170 Phase C.1: the pgvector HNSW index is part of the table —
   * it doesn't need rebuilding the way an in-memory index did. This
   * method now exists for backward compatibility (callers that expected
   * to repopulate an accelerator) and performs a no-op count of
   * already-indexed embeddings, optionally filtered by `fromTimestamp`.
   *
   * Embeddings for rows that lack one (legacy data from before pgvector
   * shipped) are generated and INSERT'd so the row participates in the
   * HNSW index.
   */
  async rebuildIndex(options: { fromTimestamp?: number } = {}): Promise<number> {
    await this.ready;

    const params: unknown[] = [];
    let where = '';
    if (options.fromTimestamp !== undefined) {
      where = 'WHERE e.ts >= $1';
      params.push(options.fromTimestamp);
    }

    const result = await this.db.query(
      `SELECT
         e.id, e.ts, e.session_id, e.task, e.input, e.output, e.critique,
         e.reward, e.success, e.latency_ms, e.tokens_used, e.tags, e.metadata,
         ee.embedding
       FROM episodes e
       LEFT JOIN episode_embeddings ee ON ee.episode_id = e.id
       ${where}
       ORDER BY e.id ASC`,
      params
    );
    const rows = result.rows as Array<EpisodeRow & { embedding: unknown | null }>;

    let reindexed = 0;
    for (const row of rows) {
      if (row.embedding) {
        reindexed++;
        continue;
      }

      // Legacy row without embedding — generate one and INSERT so the
      // row participates in the pgvector index.
      const episode: Episode = {
        id: toNumber(row.id),
        ts: toNumber(row.ts),
        sessionId: row.session_id,
        task: row.task,
        input: row.input ?? undefined,
        output: row.output ?? undefined,
        critique: row.critique ?? undefined,
        reward: row.reward,
        success: row.success === true,
        latencyMs: row.latency_ms !== null ? toNumber(row.latency_ms) : undefined,
        tokensUsed: row.tokens_used !== null ? toNumber(row.tokens_used) : undefined,
        tags: row.tags ? JSON.parse(row.tags) : undefined,
        metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : undefined,
      };
      const embedding = await this.embedder.embed(this.buildEpisodeText(episode));
      await this.storeEmbedding(toNumber(row.id), embedding);
      reindexed++;
    }

    this.queryCache.invalidateCategory('episodes');
    this.queryCache.invalidateCategory('task-stats');

    return reindexed;
  }
}

function toNumber(v: number | bigint | string | null | undefined): number {
  if (v === null || v === undefined) {
    throw new Error('toNumber: received null/undefined');
  }
  if (typeof v === 'string') return parseInt(v, 10);
  if (typeof v === 'bigint') return Number(v);
  return v;
}
