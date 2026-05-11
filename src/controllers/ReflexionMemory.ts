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
 */

import { EmbeddingService } from './EmbeddingService.js';
import type { VectorBackend } from '../backends/VectorBackend.js';
import type { LearningBackend } from '../backends/LearningBackend.js';
import type { PostgresBackend } from '../backends/postgres/PostgresBackend.js';
import { cosineSimilarity } from '../utils/vector-math.js';
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
        embedding BYTEA NOT NULL,
        embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',
        FOREIGN KEY(episode_id) REFERENCES episodes(id) ON DELETE CASCADE
      );
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

    // Hand to vector backend if present (Phase A: in-memory accelerator;
    // Phase C replaces with pgvector and removes this parallel write).
    if (this.vectorBackend) {
      try {
        this.vectorBackend.insert(episodeId.toString(), embedding);
      } catch { /* in-memory accelerator failed — SQL row is durable */ }
    }

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

    let episodes: EpisodeWithEmbedding[];
    if (this.vectorBackend) {
      episodes = await this.retrieveFromVectorBackend(queryEmbedding, query);
      // ADR-0094 Phase 13.2: vectorBackend is an in-memory accelerator;
      // postgres episode_embeddings are durable. If the accelerator came
      // back empty, fall through to the SQL similarity search before
      // declaring "no matches" (ADR-0082).
      if (episodes.length === 0) {
        episodes = await this.retrieveFromSQLFallback(queryEmbedding, query);
      }
    } else {
      episodes = await this.retrieveFromSQLFallback(queryEmbedding, query);
    }

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
   * Retrieve episodes using VectorBackend (150x faster) + SQL hydration.
   */
  private async retrieveFromVectorBackend(
    queryEmbedding: Float32Array,
    query: ReflexionQuery
  ): Promise<EpisodeWithEmbedding[]> {
    const { k = 5, minReward, onlyFailures, onlySuccesses, timeWindowDays } = query;

    const searchResults = this.vectorBackend!.search(queryEmbedding, k * 3, {
      threshold: 0.0,
    });

    const episodeIds = searchResults.map((r) => parseInt(r.id)).filter((n) => Number.isFinite(n));
    if (episodeIds.length === 0) {
      return [];
    }

    const rows = await this.fetchEpisodesByIds(episodeIds);
    const episodeMap = new Map(rows.map((r) => [toNumber(r.id).toString(), r]));

    const episodes: EpisodeWithEmbedding[] = [];
    for (const result of searchResults) {
      const row = episodeMap.get(result.id);
      if (!row) continue;

      if (
        !this.passesEpisodeFilters(row, { minReward, onlyFailures, onlySuccesses, timeWindowDays })
      ) {
        continue;
      }

      episodes.push(this.convertDatabaseEpisode(row, result.similarity));
      if (episodes.length >= k) break;
    }

    return episodes;
  }

  /**
   * Retrieve episodes using SQL-based similarity search (durable path).
   *
   * Phase C will replace this with pgvector `ORDER BY embedding <-> $1`.
   * In Phase A/B the embeddings are BYTEA blobs; cosine similarity is
   * computed in JS after a filtered SQL fetch.
   */
  private async retrieveFromSQLFallback(
    queryEmbedding: Float32Array,
    query: ReflexionQuery
  ): Promise<EpisodeWithEmbedding[]> {
    const { k = 5, minReward, onlyFailures, onlySuccesses, timeWindowDays } = query;

    const filters: string[] = [];
    const params: any[] = [];
    let nextParam = 1;

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
    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    const result = await this.db.query(
      `SELECT e.*, ee.embedding
       FROM episodes e
       JOIN episode_embeddings ee ON e.id = ee.episode_id
       ${whereClause}
       ORDER BY e.reward DESC`,
      params
    );

    const rows = result.rows as Array<EpisodeRow & { embedding: Buffer | Uint8Array }>;

    const episodes: EpisodeWithEmbedding[] = rows.map((row) => {
      const embedding = this.deserializeEmbedding(row.embedding);
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      return this.convertDatabaseEpisode(row, similarity, embedding);
    });

    episodes.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    return episodes.slice(0, k);
  }

  /**
   * Check if database row passes episode filters
   */
  private passesEpisodeFilters(
    row: EpisodeRow,
    filters: {
      minReward?: number;
      onlyFailures?: boolean;
      onlySuccesses?: boolean;
      timeWindowDays?: number;
    }
  ): boolean {
    if (filters.minReward !== undefined && row.reward < filters.minReward) return false;
    if (filters.onlyFailures && row.success === true) return false;
    if (filters.onlySuccesses && row.success === false) return false;
    if (filters.timeWindowDays) {
      const ts = toNumber(row.ts);
      if (ts < Date.now() / 1000 - filters.timeWindowDays * 86400) return false;
    }
    return true;
  }

  /**
   * Fetch episodes by IDs from database
   */
  private async fetchEpisodesByIds(episodeIds: number[]): Promise<EpisodeRow[]> {
    const placeholders = episodeIds.map((_, i) => `$${i + 1}`).join(',');
    const result = await this.db.query(
      `SELECT * FROM episodes WHERE id IN (${placeholders})`,
      episodeIds
    );
    return result.rows as EpisodeRow[];
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

  private async storeEmbedding(episodeId: number, embedding: Float32Array): Promise<void> {
    const blob = this.serializeEmbedding(embedding);
    await this.db.query(
      `INSERT INTO episode_embeddings (episode_id, embedding)
       VALUES ($1, $2)
       ON CONFLICT (episode_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
      [episodeId, blob]
    );
  }

  private serializeEmbedding(embedding: Float32Array): Buffer {
    if (!embedding || !embedding.buffer) {
      return Buffer.alloc(0);
    }
    return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  }

  private deserializeEmbedding(blob: Buffer | Uint8Array): Float32Array {
    // postgres BYTEA may surface as Buffer (pg) or Uint8Array (pglite).
    const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
    return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }

  // ========================================================================
  // GNN integration (in-process; no graph backend involved)
  // ========================================================================

  /**
   * Enhance query embedding using GNN attention mechanism.
   * Uses the vector backend (in-memory accelerator) + a SQL fetch of the
   * matched embeddings — no graph backend involved.
   */
  private async enhanceQueryWithGNN(
    queryEmbedding: Float32Array,
    k: number
  ): Promise<Float32Array> {
    if (!this.learningBackend || !this.vectorBackend) {
      return queryEmbedding;
    }

    try {
      const initialResults = this.vectorBackend.search(queryEmbedding, k * 2, {
        threshold: 0.0,
      });

      if (initialResults.length === 0) {
        return queryEmbedding;
      }

      const episodeIds = initialResults.map((r) => parseInt(r.id)).filter((n) => Number.isFinite(n));
      if (episodeIds.length === 0) return queryEmbedding;
      const placeholders = episodeIds.map((_, i) => `$${i + 1}`).join(',');

      const result = await this.db.query(
        `SELECT ee.embedding, e.reward
         FROM episode_embeddings ee
         JOIN episodes e ON e.id = ee.episode_id
         WHERE ee.episode_id IN (${placeholders})`,
        episodeIds
      );

      const neighborEmbeddings: Float32Array[] = [];
      const weights: number[] = [];
      for (const ep of result.rows as Array<{ embedding: Buffer | Uint8Array; reward: number }>) {
        neighborEmbeddings.push(this.deserializeEmbedding(ep.embedding));
        weights.push(Math.max(0.1, ep.reward));
      }

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

    if (this.vectorBackend && typeof (this.vectorBackend as any).delete === 'function') {
      try {
        const r = await (this.vectorBackend as any).delete(String(numericId));
        if (r === true) removed = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[ReflexionMemory] deleteEpisode: vector backend delete failed: ${msg}`);
      }
    }

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
   * Rebuild the in-memory vector index from the postgres `episodes` /
   * `episode_embeddings` tables. Used as a recovery path after the
   * accelerator's in-memory state was lost across a process restart.
   *
   * Returns the number of episodes re-indexed. No-ops when the SQL
   * tables are empty.
   */
  async rebuildIndex(options: { fromTimestamp?: number } = {}): Promise<number> {
    await this.ready;

    const params: any[] = [];
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
    const rows = result.rows as Array<EpisodeRow & { embedding: Buffer | Uint8Array | null }>;

    let reindexed = 0;
    for (const row of rows) {
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

      let embedding: Float32Array;
      if (row.embedding) {
        embedding = this.deserializeEmbedding(row.embedding);
      } else {
        embedding = await this.embedder.embed(this.buildEpisodeText(episode));
      }

      if (this.vectorBackend) {
        try {
          this.vectorBackend.insert(String(toNumber(row.id)), embedding, {
            type: 'episode',
            sessionId: episode.sessionId,
            reward: episode.reward,
            success: episode.success,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[ReflexionMemory] rebuildIndex: vector insert failed for ${toNumber(row.id)}: ${msg}`);
        }
      }

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
