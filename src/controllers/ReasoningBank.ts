/**
 * ReasoningBank Controller - Pattern Storage and Retrieval
 *
 * Manages reasoning patterns with embeddings for semantic similarity search.
 * Integrates with ReasoningBank WASM for high-performance pattern matching.
 *
 * Pattern Structure:
 * - taskType: Type of task (e.g., "code_review", "data_analysis")
 * - approach: Description of the reasoning approach used
 * - successRate: Success rate of this pattern (0-1)
 * - embedding: Vector embedding of the pattern for similarity search
 * - metadata: Additional contextual information
 *
 * ADR-0170 Phase B.4 (2026-05-11):
 * - Ported from SQLite (better-sqlite3 / sql.js) to PostgreSQL via PostgresBackend
 * - All DB ops route through `await this.db.query(...)` ($N placeholders)
 * - Public surface is now uniformly async (was a mix of sync+async)
 * - `reasoning_pattern_vec` Option F mirror retired (vec0 is sqlite-only)
 * - `pattern_embeddings.embedding` stays as BYTEA Float32Array (Phase C → pgvector)
 *
 * AgentDB v2 (preserved):
 * - VectorBackend abstraction for 8x faster search (RuVector/hnswlib)
 * - Optional GNN enhancement via LearningBackend
 * - useGNN option, recordOutcome for learning
 */

import { EmbeddingService } from './EmbeddingService.js';
import type { VectorBackend, SearchResult } from '../backends/VectorBackend.js';
import { cosineSimilarity } from '../utils/vector-math.js';
import type { PostgresBackend } from '../backends/postgres/PostgresBackend.js';

export interface ReasoningPattern {
  id?: number;
  taskType: string;
  approach: string;
  successRate: number;
  embedding?: Float32Array;
  uses?: number;
  avgReward?: number;
  tags?: string[];
  metadata?: Record<string, any>;
  createdAt?: number;
  similarity?: number; // Cosine similarity score (for search results)
}

export interface PatternSearchQuery {
  /** v1 API: Task string (will be embedded automatically) */
  task?: string;
  /** v2 API: Pre-computed embedding */
  taskEmbedding?: Float32Array;
  k?: number;
  threshold?: number;
  /** Enable GNN-based query enhancement (requires LearningBackend) */
  useGNN?: boolean;
  filters?: {
    taskType?: string;
    minSuccessRate?: number;
    tags?: string[];
  };
}

export interface PatternStats {
  totalPatterns: number;
  avgSuccessRate: number;
  avgUses: number;
  topTaskTypes: Array<{ taskType: string; count: number }>;
  recentPatterns: number;
  highPerformingPatterns: number;
}

/**
 * Optional GNN Learning Backend for query enhancement
 */
export interface LearningBackend {
  /**
   * Enhance query embedding using GNN and neighbor context
   */
  enhance(query: Float32Array, neighbors: Float32Array[], weights: number[]): Float32Array;

  /**
   * Add training sample for future learning
   */
  addSample(embedding: Float32Array, success: boolean): void;

  /**
   * Train the GNN model
   */
  train(options?: { epochs?: number; batchSize?: number }): Promise<{
    epochs: number;
    finalLoss: number;
  }>;
}

// ADR-0076 A4: Dual-instance guard — prevent duplicate construction
// when both ControllerRegistry and AgentDBService create this controller
let _singleton: InstanceType<typeof ReasoningBank> | null = null;

// Postgres returns BYTEA as Node Buffer; coerce to Float32Array.
function bufferToFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

// Postgres returns JSONB as parsed object/array already; only string columns
// holding stringified JSON need JSON.parse.
function parseJsonField(v: unknown): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

export class ReasoningBank {
  // ADR-0076 A4: definite-assignment due to _singleton early-return pattern in ctor
  private db!: PostgresBackend;
  private embedder!: EmbeddingService;
  private cache!: Map<string, any>;
  private schemaReady!: Promise<void>;

  // v2: Optional vector backend (uses legacy if not provided)
  private vectorBackend?: VectorBackend;
  private learningBackend?: LearningBackend;

  // Maps pattern ID (number) to vector backend ID (string) for hybrid mode
  private idMapping: Map<number, string> = new Map();
  private nextVectorId = 0;

  /**
   * Constructor (ADR-0170 Phase B.4):
   *   new ReasoningBank(postgresBackend, embedder, vectorBackend?, learningBackend?)
   *
   * The first arg is now a `PostgresBackend` (substrate handle exposing
   * async `query()` / `exec()`). Previously this accepted an
   * `IDatabaseConnection` (better-sqlite3 / sql.js). The Phase B port is
   * atomic: the SQLite path is dead-stripped in the same commit.
   *
   * Schema initialization is deferred to a Promise (`schemaReady`) because
   * postgres DDL is async; constructors stay sync to preserve the singleton
   * early-return pattern. Every public method awaits `schemaReady` before
   * touching the DB.
   */
  static _resetSingleton(): void { _singleton = null; }

  constructor(
    db: PostgresBackend,
    embedder: EmbeddingService,
    vectorBackend?: VectorBackend,
    learningBackend?: LearningBackend
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
    this.cache = new Map();
    this.schemaReady = this.initializeSchema();
  }

  /**
   * Initialize reasoning patterns schema (postgres dialect).
   *
   * `BIGSERIAL` replaces `INTEGER PRIMARY KEY AUTOINCREMENT`.
   * `EXTRACT(EPOCH FROM NOW())::BIGINT` replaces `strftime('%s', 'now')`.
   * `BYTEA` replaces `BLOB`.
   * `JSONB` replaces stringified-JSON TEXT for `metadata` (and `tags` array
   * stays a JSON TEXT column for compat with serialized-array writes).
   */
  private async initializeSchema(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS reasoning_patterns (
        id BIGSERIAL PRIMARY KEY,
        ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        task_type TEXT NOT NULL,
        approach TEXT NOT NULL,
        success_rate REAL NOT NULL DEFAULT 0.0,
        uses BIGINT DEFAULT 0,
        avg_reward REAL DEFAULT 0.0,
        tags TEXT,
        metadata JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_patterns_task_type ON reasoning_patterns(task_type);
      CREATE INDEX IF NOT EXISTS idx_patterns_success_rate ON reasoning_patterns(success_rate);
      CREATE INDEX IF NOT EXISTS idx_patterns_uses ON reasoning_patterns(uses);

      CREATE TABLE IF NOT EXISTS pattern_embeddings (
        pattern_id BIGINT PRIMARY KEY,
        embedding BYTEA NOT NULL,
        FOREIGN KEY (pattern_id) REFERENCES reasoning_patterns(id) ON DELETE CASCADE
      );
    `);
  }

  /**
   * Store a reasoning pattern with embedding.
   *
   * Phase B.4: SQLite `INSERT … VALUES (?, …)` + `lastInsertRowid` is
   * replaced by postgres `INSERT … RETURNING id`. Metadata is JSONB so
   * we cast `$N::jsonb` at the parameter site (Buffer→string round-trip).
   */
  async storePattern(pattern: ReasoningPattern): Promise<number> {
    await this.schemaReady;

    const embedding = await this.embedder.embed(
      `${pattern.taskType}: ${pattern.approach}`
    );

    const tagsValue = pattern.tags ? JSON.stringify(pattern.tags) : null;
    const metadataValue = pattern.metadata ? JSON.stringify(pattern.metadata) : null;

    const insertResult = await this.db.query(
      `INSERT INTO reasoning_patterns
         (task_type, approach, success_rate, uses, avg_reward, tags, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id`,
      [
        pattern.taskType,
        pattern.approach,
        pattern.successRate,
        pattern.uses ?? 0,
        pattern.avgReward ?? 0.0,
        tagsValue,
        metadataValue,
      ],
    );

    const idRow = insertResult.rows[0] as { id: number | string } | undefined;
    if (!idRow) {
      throw new Error('[ReasoningBank] storePattern: INSERT … RETURNING id returned no rows');
    }
    const patternId = typeof idRow.id === 'string' ? parseInt(idRow.id, 10) : Number(idRow.id);

    if (this.vectorBackend) {
      try {
        const vectorId = `pattern_${this.nextVectorId++}`;
        this.idMapping.set(patternId, vectorId);

        this.vectorBackend.insert(vectorId, embedding, {
          patternId,
          taskType: pattern.taskType,
          successRate: pattern.successRate,
        });
      } catch {
        // VectorBackend insert failed — fall back to SQL-side blob storage
        await this.storePatternEmbedding(patternId, embedding);
      }
    } else {
      await this.storePatternEmbedding(patternId, embedding);
    }

    this.cache.clear();

    return patternId;
  }

  /**
   * Store pattern embedding as BYTEA Float32Array.
   *
   * Phase B.4: `INSERT OR REPLACE` → postgres `INSERT … ON CONFLICT … DO UPDATE`.
   * Phase C will replace the BYTEA column with `vector(N)` (pgvector).
   */
  private async storePatternEmbedding(patternId: number, embedding: Float32Array): Promise<void> {
    const blob = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

    await this.db.query(
      `INSERT INTO pattern_embeddings (pattern_id, embedding)
       VALUES ($1, $2)
       ON CONFLICT (pattern_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
      [patternId, blob],
    );
  }

  /**
   * Search patterns by semantic similarity.
   */
  async searchPatterns(query: PatternSearchQuery): Promise<ReasoningPattern[]> {
    await this.schemaReady;

    let queryEmbedding: Float32Array;
    if (query.task && !query.taskEmbedding) {
      queryEmbedding = await this.embedder.embed(query.task);
    } else if (query.taskEmbedding) {
      queryEmbedding = query.taskEmbedding;
    } else {
      throw new Error('PatternSearchQuery must provide either task (v1) or taskEmbedding (v2)');
    }

    const enrichedQuery: PatternSearchQuery & { taskEmbedding: Float32Array } = {
      ...query,
      taskEmbedding: queryEmbedding,
    };

    if (this.vectorBackend) {
      return this.searchPatternsV2(enrichedQuery);
    }
    return this.searchPatternsLegacy(enrichedQuery);
  }

  /**
   * v2: Search using VectorBackend with optional GNN enhancement
   */
  private async searchPatternsV2(query: PatternSearchQuery & { taskEmbedding: Float32Array }): Promise<ReasoningPattern[]> {
    const k = query.k || 10;
    const threshold = query.threshold || 0.0;
    let queryEmbedding = query.taskEmbedding;

    try {
      if (query.useGNN && this.learningBackend) {
        const candidates = this.vectorBackend!.search(queryEmbedding, k * 3, { threshold: 0.0 });

        if (candidates.length > 0) {
          const neighborEmbeddings = await this.getEmbeddingsForVectorIds(
            candidates.map(c => c.id)
          );
          const weights = candidates.map(c => c.similarity);

          queryEmbedding = this.learningBackend.enhance(queryEmbedding, neighborEmbeddings, weights);
        }
      }

      const results = this.vectorBackend!.search(queryEmbedding, k, { threshold });

      return await this.hydratePatterns(results);
    } catch {
      // VectorBackend search failed — fall back to SQL-blob cosine search
      return this.searchPatternsLegacy(query);
    }
  }

  /**
   * v1: SQL-blob cosine search (Phase C replaces with pgvector ORDER BY <-> $1).
   */
  private async searchPatternsLegacy(query: PatternSearchQuery & { taskEmbedding: Float32Array }): Promise<ReasoningPattern[]> {
    const k = query.k || 10;
    const threshold = query.threshold || 0.0;

    const conditions: string[] = [];
    const params: any[] = [];
    let p = 1;

    if (query.filters?.taskType) {
      conditions.push(`rp.task_type = $${p++}`);
      params.push(query.filters.taskType);
    }

    if (query.filters?.minSuccessRate !== undefined) {
      conditions.push(`rp.success_rate >= $${p++}`);
      params.push(query.filters.minSuccessRate);
    }

    if (query.filters?.tags && query.filters.tags.length > 0) {
      const tagConditions = query.filters.tags.map(() => `rp.tags LIKE $${p++}`).join(' OR ');
      conditions.push(`(${tagConditions})`);
      query.filters.tags.forEach(tag => {
        params.push(`%"${tag}"%`);
      });
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const result = await this.db.query(
      `SELECT
         rp.id,
         rp.ts,
         rp.task_type,
         rp.approach,
         rp.success_rate,
         rp.uses,
         rp.avg_reward,
         rp.tags,
         rp.metadata,
         pe.embedding
       FROM reasoning_patterns rp
       JOIN pattern_embeddings pe ON rp.id = pe.pattern_id
       ${whereClause}`,
      params,
    );

    const rows = result.rows as Array<{
      id: number | string;
      ts: number | string;
      task_type: string;
      approach: string;
      success_rate: number;
      uses: number | string;
      avg_reward: number;
      tags: string | null;
      metadata: unknown;
      embedding: Buffer;
    }>;

    const candidates = rows.map(row => {
      const embedding = bufferToFloat32(row.embedding);
      const similarity = cosineSimilarity(query.taskEmbedding, embedding);

      return {
        id: typeof row.id === 'string' ? parseInt(row.id, 10) : Number(row.id),
        taskType: row.task_type,
        approach: row.approach,
        successRate: row.success_rate,
        uses: typeof row.uses === 'string' ? parseInt(row.uses, 10) : Number(row.uses),
        avgReward: row.avg_reward,
        tags: row.tags ? JSON.parse(row.tags) : [],
        metadata: parseJsonField(row.metadata) ?? {},
        createdAt: typeof row.ts === 'string' ? parseInt(row.ts, 10) : Number(row.ts),
        embedding,
        similarity,
      };
    });

    const filtered = candidates
      .filter(c => c.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);

    return filtered;
  }

  /**
   * Hydrate VectorBackend search results with row metadata (one SELECT per id).
   */
  private async hydratePatterns(results: SearchResult[]): Promise<ReasoningPattern[]> {
    const hydrated: ReasoningPattern[] = [];

    for (const result of results) {
      const patternId = result.metadata?.patternId;
      if (!patternId) {
        throw new Error(`VectorBackend result missing patternId: ${result.id}`);
      }

      const rowResult = await this.db.query(
        `SELECT * FROM reasoning_patterns WHERE id = $1`,
        [patternId],
      );
      const row = rowResult.rows[0] as any;

      if (!row) {
        throw new Error(`Pattern ${patternId} not found in database`);
      }

      hydrated.push({
        id: typeof row.id === 'string' ? parseInt(row.id, 10) : Number(row.id),
        taskType: row.task_type,
        approach: row.approach,
        successRate: row.success_rate,
        uses: typeof row.uses === 'string' ? parseInt(row.uses, 10) : Number(row.uses),
        avgReward: row.avg_reward,
        tags: row.tags ? JSON.parse(row.tags) : [],
        metadata: parseJsonField(row.metadata) ?? {},
        createdAt: typeof row.ts === 'string' ? parseInt(row.ts, 10) : Number(row.ts),
        similarity: result.similarity,
      });
    }

    return hydrated;
  }

  /**
   * Get embeddings for vector IDs (for GNN)
   */
  private async getEmbeddingsForVectorIds(vectorIds: string[]): Promise<Float32Array[]> {
    const embeddings: Float32Array[] = [];

    for (const vectorId of vectorIds) {
      let patternId: number | undefined;
      for (const [pid, vid] of this.idMapping.entries()) {
        if (vid === vectorId) {
          patternId = pid;
          break;
        }
      }

      if (patternId) {
        const pattern = await this.getPattern(patternId);
        if (pattern?.approach) {
          const embedding = await this.embedder.embed(
            `${pattern.taskType}: ${pattern.approach}`
          );
          embeddings.push(embedding);
        }
      }
    }

    return embeddings;
  }

  /**
   * Get pattern statistics.
   *
   * Phase B.4: postgres is stricter about GROUP BY than SQLite. The
   * `topTaskTypes` query selects only `task_type` and `COUNT(*)`, both
   * of which are valid in postgres GROUP BY (the non-aggregate column
   * appears in GROUP BY). The other aggregate queries (`SELECT COUNT(*)`,
   * `SELECT AVG(...)`) have zero non-aggregated columns and are trivially
   * compliant.
   */
  async getPatternStats(): Promise<PatternStats> {
    await this.schemaReady;

    const cacheKey = 'pattern_stats';
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const totalResult = await this.db.query(
      `SELECT COUNT(*) AS count FROM reasoning_patterns`,
    );
    const totalRow = totalResult.rows[0] as { count: number | string } | undefined;

    const avgResult = await this.db.query(
      `SELECT
         AVG(success_rate) AS avg_success_rate,
         AVG(uses) AS avg_uses
       FROM reasoning_patterns`,
    );
    const avgRow = avgResult.rows[0] as { avg_success_rate: number | string | null; avg_uses: number | string | null } | undefined;

    // GROUP BY: task_type is the only non-aggregate column in SELECT and it
    // is in the GROUP BY — postgres-strict-compliant.
    const topResult = await this.db.query(
      `SELECT
         task_type,
         COUNT(*) AS count
       FROM reasoning_patterns
       GROUP BY task_type
       ORDER BY count DESC
       LIMIT 10`,
    );
    const topRows = topResult.rows as Array<{ task_type: string; count: number | string }>;

    const recentResult = await this.db.query(
      `SELECT COUNT(*) AS count
       FROM reasoning_patterns
       WHERE ts >= EXTRACT(EPOCH FROM NOW())::BIGINT - 86400 * 7`,
    );
    const recentRow = recentResult.rows[0] as { count: number | string } | undefined;

    const highPerfResult = await this.db.query(
      `SELECT COUNT(*) AS count
       FROM reasoning_patterns
       WHERE success_rate >= 0.8`,
    );
    const highPerfRow = highPerfResult.rows[0] as { count: number | string } | undefined;

    const stats: PatternStats = {
      totalPatterns: totalRow ? Number(totalRow.count) : 0,
      avgSuccessRate: avgRow?.avg_success_rate != null ? Number(avgRow.avg_success_rate) : 0,
      avgUses: avgRow?.avg_uses != null ? Number(avgRow.avg_uses) : 0,
      topTaskTypes: topRows.map(row => ({
        taskType: row.task_type,
        count: Number(row.count),
      })),
      recentPatterns: recentRow ? Number(recentRow.count) : 0,
      highPerformingPatterns: highPerfRow ? Number(highPerfRow.count) : 0,
    };

    this.cache.set(cacheKey, stats);
    setTimeout(() => this.cache.delete(cacheKey), 5 * 60 * 1000);

    return stats;
  }

  /**
   * Update pattern statistics after use.
   *
   * Phase B.4 nuance: SQLite let the same row's `uses` column be referenced
   * twice in one statement and evaluated against the OLD value uniformly.
   * Postgres does the same for non-volatile expressions in a single
   * UPDATE — the row is read once, all RHS references see the pre-update
   * snapshot, then the new tuple is written. So the original three-way
   * read of `uses` (twice as a multiplier, once for the +1) is preserved
   * verbatim.
   */
  async updatePatternStats(
    patternId: number,
    success: boolean,
    reward: number
  ): Promise<void> {
    await this.schemaReady;

    await this.db.query(
      `UPDATE reasoning_patterns
       SET
         uses = uses + 1,
         success_rate = (success_rate * uses + $1) / (uses + 1),
         avg_reward = (avg_reward * uses + $2) / (uses + 1)
       WHERE id = $3`,
      [success ? 1 : 0, reward, patternId],
    );

    this.cache.clear();
  }

  /**
   * Record pattern outcome for GNN learning (v2 feature)
   */
  async recordOutcome(
    patternId: number,
    success: boolean,
    reward?: number
  ): Promise<void> {
    const actualReward = reward !== undefined ? reward : (success ? 1.0 : 0.0);
    await this.updatePatternStats(patternId, success, actualReward);

    if (this.learningBackend) {
      const pattern = await this.getPattern(patternId);
      if (pattern?.approach) {
        const embedding = await this.embedder.embed(
          `${pattern.taskType}: ${pattern.approach}`
        );
        this.learningBackend.addSample(embedding, success);
      }
    }
  }

  /**
   * Train GNN model on collected samples (v2 feature)
   */
  async trainGNN(options?: { epochs?: number; batchSize?: number }): Promise<{
    epochs: number;
    finalLoss: number;
  }> {
    if (!this.learningBackend) {
      throw new Error('GNN learning not available. Initialize ReasoningBank with LearningBackend.');
    }

    return this.learningBackend.train(options);
  }

  /**
   * Get pattern by ID
   */
  async getPattern(patternId: number): Promise<ReasoningPattern | null> {
    await this.schemaReady;

    const result = await this.db.query(
      `SELECT
         rp.id,
         rp.ts,
         rp.task_type,
         rp.approach,
         rp.success_rate,
         rp.uses,
         rp.avg_reward,
         rp.tags,
         rp.metadata,
         pe.embedding
       FROM reasoning_patterns rp
       LEFT JOIN pattern_embeddings pe ON rp.id = pe.pattern_id
       WHERE rp.id = $1`,
      [patternId],
    );

    const row = result.rows[0] as any;
    if (!row) return null;

    return {
      id: typeof row.id === 'string' ? parseInt(row.id, 10) : Number(row.id),
      taskType: row.task_type,
      approach: row.approach,
      successRate: row.success_rate,
      uses: typeof row.uses === 'string' ? parseInt(row.uses, 10) : Number(row.uses),
      avgReward: row.avg_reward,
      tags: row.tags ? JSON.parse(row.tags) : [],
      metadata: parseJsonField(row.metadata) ?? {},
      createdAt: typeof row.ts === 'string' ? parseInt(row.ts, 10) : Number(row.ts),
      embedding: row.embedding ? bufferToFloat32(row.embedding) : undefined,
    };
  }

  /**
   * Delete pattern by ID.
   *
   * Phase B.4: postgres UPDATE/DELETE returns affected row count via the
   * `pg` driver's `rowCount` field. `pglite`'s `query()` result also
   * carries `rowCount` per the @electric-sql/pglite Result<T> shape; both
   * surface it on the top-level result, not on `rows`. Read it via the
   * loose return-type accessor.
   */
  async deletePattern(patternId: number): Promise<boolean> {
    await this.schemaReady;

    const result = await this.db.query(
      `DELETE FROM reasoning_patterns WHERE id = $1`,
      [patternId],
    );

    this.cache.clear();

    const rowCount = (result as { rowCount?: number }).rowCount;
    return (rowCount ?? 0) > 0;
  }

  /**
   * Clear query cache
   */
  clearCache(): void {
    this.cache.clear();
  }

}
