/**
 * CausalMemoryGraph - Causal Reasoning over Agent Memories
 *
 * Implements intervention-based reasoning rather than correlation.
 * Stores p(y|do(x)) estimates and tracks causal uplift across episodes.
 *
 * Based on:
 * - Pearl's do-calculus and causal inference
 * - Uplift modeling from A/B testing
 * - Instrumental variable methods
 *
 * ADR-0170 Phase B.7 port (2026-05-11):
 *   - PostgreSQL substrate via PostgresBackend (pglite embedded or postgres://server)
 *   - WITH RECURSIVE 5-hop chain traversal hardened for postgres dialect:
 *     SQLite `MIN(a,b)` row-wise → postgres `LEAST(a,b)`; explicit `::TEXT` /
 *     `::BIGINT` casts in the recursive UNION ALL so column types match
 *     between anchor and recursive arms; `UNION ALL` retained for path
 *     enumeration (paths are distinct by construction); cycle prevention
 *     via the existing manual `path NOT LIKE '%...%'` check (no
 *     postgres-native CYCLE clause — keeps the query portable to pglite
 *     which targets postgres 15).
 *   - `@ruvector/graph-node` Cypher branch retired per resolution-J
 *     (zero in-fork consumers; Cypher WHERE evaluator incomplete; every
 *     in-use query reduces cleanly to SQL).
 *   - SQLite-shaped CREATE TABLE bootstrap removed — schema lives in
 *     `schemas/frontier-schema.sql` and is loaded by AgentDB init against
 *     PostgresBackend.exec().
 *
 * v2.0.0-alpha.3 Features (retained):
 *   - HyperbolicAttention for tree-structured causal chain retrieval
 *   - Poincaré embeddings for hierarchical relationships
 *   - Feature flag: ENABLE_HYPERBOLIC_ATTENTION (default: false)
 */

import type { PostgresBackend } from '../backends/postgres/PostgresBackend.js';
import { AttentionService, type HyperbolicAttentionConfig } from '../utils/LegacyAttentionAdapter.js';
import { EmbeddingService } from './EmbeddingService.js';
import type { VectorBackend } from '../backends/VectorBackend.js';
import { getEmbeddingConfig } from '../config/embedding-config.js';

/**
 * Configuration for CausalMemoryGraph
 */
export interface CausalMemoryGraphConfig {
  /** Enable hyperbolic attention for causal chains (default: false) */
  ENABLE_HYPERBOLIC_ATTENTION?: boolean;
  /** Hyperbolic attention configuration */
  hyperbolicConfig?: Partial<HyperbolicAttentionConfig>;
}

export interface CausalEdge {
  id?: number;
  fromMemoryId: number;
  fromMemoryType: 'episode' | 'skill' | 'note' | 'fact';
  toMemoryId: number;
  toMemoryType: 'episode' | 'skill' | 'note' | 'fact';

  // Metrics
  similarity: number;
  uplift?: number; // E[y|do(x)] - E[y]
  confidence: number;
  sampleSize?: number;

  // Evidence
  evidenceIds?: string[];
  experimentIds?: string[];
  confounderScore?: number;

  // Explanation
  mechanism?: string;
  metadata?: Record<string, any>;
}

export interface CausalExperiment {
  id?: number;
  name: string;
  hypothesis: string;
  treatmentId: number;
  treatmentType: string;
  controlId?: number;

  // Design
  startTime: number;
  endTime?: number;
  sampleSize: number;

  // Results
  treatmentMean?: number;
  controlMean?: number;
  uplift?: number;
  pValue?: number;
  confidenceIntervalLow?: number;
  confidenceIntervalHigh?: number;

  status: 'running' | 'completed' | 'failed';
  metadata?: Record<string, any>;
}

export interface CausalObservation {
  experimentId: number;
  episodeId: number;
  isTreatment: boolean;
  outcomeValue: number;
  outcomeType: 'reward' | 'success' | 'latency';
  context?: Record<string, any>;
}

export interface CausalQuery {
  interventionMemoryId: number;
  interventionMemoryType: string;
  outcomeMemoryId?: number;
  minConfidence?: number;
  minUplift?: number;
}

// ADR-0076 A4: Dual-instance guard — prevent duplicate construction
// when both ControllerRegistry and AgentDBService create this controller
let _singleton: InstanceType<typeof CausalMemoryGraph> | null = null;

export class CausalMemoryGraph {
  // ADR-0076 A4: definite-assignment due to _singleton early-return pattern in ctor
  private db!: PostgresBackend;
  private attentionService?: AttentionService;
  private embedder?: EmbeddingService;
  private vectorBackend?: VectorBackend;
  private config!: CausalMemoryGraphConfig;

  /**
   * Reset the dual-instance singleton guard. Used by tests.
   */
  static _resetSingleton(): void { _singleton = null; }

  /**
   * Construct CausalMemoryGraph against a postgres-backed substrate.
   *
   * Phase B.7 signature (was: db, graphBackend, embedder, config, vectorBackend, attentionService).
   * The `graphBackend` parameter is removed — graph-node Cypher path retires under postgres.
   *
   * @param db - PostgresBackend handle (pglite embedded or postgres://server)
   * @param embedder - Optional embedding service for mechanism embeddings
   * @param config - Optional configuration for hyperbolic attention
   * @param vectorBackend - Optional vector backend for similarity search
   * @param attentionService - Optional shared AttentionService singleton
   */
  constructor(
    db: PostgresBackend,
    embedder?: EmbeddingService,
    config?: CausalMemoryGraphConfig,
    vectorBackend?: VectorBackend,
    attentionService?: AttentionService,
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
    this.config = {
      ENABLE_HYPERBOLIC_ATTENTION: false,
      ...config,
    };

    // Schema is owned by `schemas/frontier-schema.sql` and applied at
    // AgentDB init time. The Phase A.5 schemas use BIGSERIAL /
    // EXTRACT(EPOCH FROM NOW()) / JSONB / BOOLEAN — postgres dialect.
    // No per-controller DDL bootstrap (ADR-0170 Phase B.7).

    if (attentionService) {
      this.attentionService = attentionService;
    } else if (embedder && this.config.ENABLE_HYPERBOLIC_ATTENTION) {
      // AttentionService doesn't reach into the SQL substrate; the db
      // handle is forwarded as-is.
      this.attentionService = new AttentionService(db as any, {
        hyperbolic: {
          enabled: true,
          ...this.config.hyperbolicConfig,
        },
      });
    }
  }

  /**
   * Add a causal edge between memories.
   *
   * When vectorBackend is available, also stores the mechanism embedding
   * for fast similarity search across the causal graph.
   */
  async addCausalEdge(edge: CausalEdge): Promise<number> {
    const mechanismText = edge.mechanism || `${edge.fromMemoryType}-${edge.toMemoryType} causal link`;
    let embedding: Float32Array;

    if (this.embedder) {
      embedding = await this.embedder.embed(mechanismText);
    } else {
      embedding = new Float32Array(getEmbeddingConfig().dimension).fill(0);
    }

    const result = await this.db.query(
      `INSERT INTO causal_edges (
         from_memory_id, from_memory_type, to_memory_id, to_memory_type,
         similarity, uplift, confidence, sample_size,
         evidence_ids, confounder_score,
         mechanism, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        edge.fromMemoryId,
        edge.fromMemoryType,
        edge.toMemoryId,
        edge.toMemoryType,
        edge.similarity,
        edge.uplift ?? null,
        edge.confidence,
        edge.sampleSize ?? null,
        edge.evidenceIds ? JSON.stringify(edge.evidenceIds) : null,
        edge.confounderScore ?? null,
        edge.mechanism ?? null,
        edge.metadata ? JSON.stringify(edge.metadata) : null,
      ],
    );

    const edgeId = Number((result.rows[0] as any).id);

    if (this.vectorBackend && embedding) {
      this.vectorBackend.insert(`causal-edge:${edgeId}`, embedding, {
        fromMemoryId: edge.fromMemoryId,
        fromMemoryType: edge.fromMemoryType,
        toMemoryId: edge.toMemoryId,
        toMemoryType: edge.toMemoryType,
        mechanism: mechanismText,
        confidence: edge.confidence,
        uplift: edge.uplift,
      });
    }

    return edgeId;
  }

  /**
   * Create a causal experiment (A/B test)
   */
  async createExperiment(experiment: CausalExperiment): Promise<number> {
    const result = await this.db.query(
      `INSERT INTO causal_experiments (
         name, hypothesis, treatment_id, treatment_type, control_id,
         start_time, sample_size, status, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        experiment.name,
        experiment.hypothesis,
        experiment.treatmentId,
        experiment.treatmentType,
        experiment.controlId ?? null,
        experiment.startTime,
        experiment.sampleSize,
        experiment.status,
        experiment.metadata ? JSON.stringify(experiment.metadata) : null,
      ],
    );

    return Number((result.rows[0] as any).id);
  }

  /**
   * Record an observation in an experiment
   */
  async recordObservation(observation: CausalObservation): Promise<void> {
    await this.db.query(
      `INSERT INTO causal_observations (
         experiment_id, episode_id, is_treatment, outcome_value, outcome_type, context
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        observation.experimentId,
        observation.episodeId,
        observation.isTreatment,
        observation.outcomeValue,
        observation.outcomeType,
        observation.context ? JSON.stringify(observation.context) : null,
      ],
    );

    await this.db.query(
      `UPDATE causal_experiments
         SET sample_size = sample_size + 1
       WHERE id = $1`,
      [observation.experimentId],
    );
  }

  /**
   * Calculate uplift for an experiment.
   *
   * Postgres-substrate note: `is_treatment` is a BOOLEAN column under
   * postgres (was 0/1 INTEGER under SQLite). Filter on `=== true` /
   * `=== false` after the rows come back.
   */
  async calculateUplift(experimentId: number): Promise<{
    uplift: number;
    pValue: number;
    confidenceInterval: [number, number];
  }> {
    const observationsResult = await this.db.query(
      `SELECT is_treatment, outcome_value
         FROM causal_observations
        WHERE experiment_id = $1`,
      [experimentId],
    );
    const observations = observationsResult.rows as Array<{ is_treatment: boolean; outcome_value: number }>;

    const treatmentValues = observations
      .filter(o => o.is_treatment === true)
      .map(o => o.outcome_value);

    const controlValues = observations
      .filter(o => o.is_treatment === false)
      .map(o => o.outcome_value);

    if (treatmentValues.length === 0 || controlValues.length === 0) {
      return { uplift: 0, pValue: 1.0, confidenceInterval: [0, 0] };
    }

    const treatmentMean = this.mean(treatmentValues);
    const controlMean = this.mean(controlValues);
    const uplift = treatmentMean - controlMean;

    const treatmentSE = this.standardError(treatmentValues);
    const controlSE = this.standardError(controlValues);
    const pooledSE = Math.sqrt(treatmentSE ** 2 + controlSE ** 2);

    const tStat = uplift / pooledSE;
    const df = treatmentValues.length + controlValues.length - 2;
    const pValue = 2 * (1 - this.tCDF(Math.abs(tStat), df));

    const tCritical = this.tInverse(0.025, df);
    const marginOfError = tCritical * pooledSE;
    const confidenceInterval: [number, number] = [
      uplift - marginOfError,
      uplift + marginOfError,
    ];

    await this.db.query(
      `UPDATE causal_experiments
          SET treatment_mean = $1,
              control_mean = $2,
              uplift = $3,
              p_value = $4,
              confidence_interval_low = $5,
              confidence_interval_high = $6,
              status = 'completed'
        WHERE id = $7`,
      [treatmentMean, controlMean, uplift, pValue, confidenceInterval[0], confidenceInterval[1], experimentId],
    );

    return { uplift, pValue, confidenceInterval };
  }

  /**
   * Query causal effects
   */
  async queryCausalEffects(query: CausalQuery): Promise<CausalEdge[]> {
    const {
      interventionMemoryId,
      interventionMemoryType,
      outcomeMemoryId,
      minConfidence = 0.5,
      minUplift = 0.0,
    } = query;

    let sql = `
      SELECT * FROM causal_edges
       WHERE from_memory_id = $1
         AND from_memory_type = $2
         AND confidence >= $3
         AND ABS(COALESCE(uplift, 0)) >= $4
    `;
    const params: unknown[] = [
      interventionMemoryId,
      interventionMemoryType,
      minConfidence,
      minUplift,
    ];

    if (outcomeMemoryId !== undefined) {
      params.push(outcomeMemoryId);
      sql += ` AND to_memory_id = $${params.length}`;
    }

    sql += ' ORDER BY ABS(COALESCE(uplift, 0)) * confidence DESC';

    const result = await this.db.query(sql, params);
    return (result.rows as any[]).map(row => this.rowToCausalEdge(row));
  }

  /**
   * Find similar causal patterns using vector similarity search.
   *
   * Postgres-substrate note: the k-NN search still routes through the
   * injected VectorBackend (RuVector/RVF) in Phase B. Phase C lights up
   * pgvector and lets the planner do the search natively.
   *
   * @param mechanism - The causal mechanism description to search for
   * @param k - Number of similar patterns to return (default: 10)
   * @param minConfidence - Minimum confidence threshold (default: 0.5)
   */
  async findSimilarCausalPatterns(
    mechanism: string,
    k: number = 10,
    minConfidence: number = 0.5,
  ): Promise<Array<CausalEdge & { similarity: number }>> {
    if (!this.embedder || !this.vectorBackend) {
      return [];
    }

    const queryEmbedding = await this.embedder.embed(mechanism);
    const results = this.vectorBackend.search(queryEmbedding, k * 2);

    const filteredResults = results.filter(result => {
      if (!result.id.startsWith('causal-edge:')) return false;
      const confidence = result.metadata?.confidence as number | undefined;
      return confidence === undefined || confidence >= minConfidence;
    });

    const edges: Array<CausalEdge & { similarity: number }> = [];

    for (const result of filteredResults.slice(0, k)) {
      const edgeId = parseInt(result.id.replace('causal-edge:', ''), 10);
      if (isNaN(edgeId)) continue;

      const rowResult = await this.db.query(
        'SELECT * FROM causal_edges WHERE id = $1',
        [edgeId],
      );
      const row = rowResult.rows[0];

      if (row) {
        edges.push({
          ...this.rowToCausalEdge(row as any),
          similarity: result.similarity,
        });
      }
    }

    return edges;
  }

  /**
   * Get causal chain (multi-hop reasoning).
   *
   * Phase B.7 — postgres dialect details for the 5-hop WITH RECURSIVE:
   *   - `MIN(chain.min_confidence, ce.confidence)` (SQLite row-wise) is
   *     rewritten as `LEAST(chain.min_confidence, ce.confidence)` — postgres
   *     `MIN` is the aggregate, `LEAST` is the row-level minimum.
   *   - BIGINT id columns are cast to TEXT explicitly when concatenated
   *     into the chain path so the recursive CTE's column types line up
   *     between anchor and recursive arms (postgres is strict; SQLite
   *     was lenient).
   *   - `COALESCE(uplift, 0)` guards against NULL uplift breaking the
   *     `total_uplift + ce.uplift` arithmetic (postgres makes NULL+REAL=NULL,
   *     which would propagate up the entire chain).
   *   - Cycle prevention is the same manual `path NOT LIKE '%...%'`
   *     pattern with an explicit `::TEXT` cast on the BIGINT id.
   *
   * @param fromMemoryId - Starting memory node
   * @param toMemoryId - Target memory node
   * @param maxDepth - Maximum chain depth (default: 5)
   * @returns Ranked causal chains with paths, uplift, and confidence
   */
  async getCausalChain(fromMemoryId: number, toMemoryId: number, maxDepth: number = 5): Promise<{
    path: number[];
    totalUplift: number;
    confidence: number;
    attentionMetrics?: {
      hyperbolicDistance: number[];
      computeTimeMs: number;
    };
  }[]> {
    if (this.attentionService && this.embedder) {
      return this.getCausalChainWithAttention(fromMemoryId, toMemoryId, maxDepth);
    }

    const result = await this.db.query(
      `WITH RECURSIVE chain(from_id, to_id, depth, path, total_uplift, min_confidence) AS (
         SELECT
           from_memory_id,
           to_memory_id,
           1,
           from_memory_id::TEXT || '->' || to_memory_id::TEXT,
           COALESCE(uplift, 0)::REAL,
           confidence
         FROM causal_edges
         WHERE from_memory_id = $1 AND confidence >= 0.5

         UNION ALL

         SELECT
           chain.from_id,
           ce.to_memory_id,
           chain.depth + 1,
           chain.path || '->' || ce.to_memory_id::TEXT,
           chain.total_uplift + COALESCE(ce.uplift, 0)::REAL,
           LEAST(chain.min_confidence, ce.confidence)
         FROM chain
         JOIN causal_edges ce ON chain.to_id = ce.from_memory_id
         WHERE chain.depth < $2
           AND ce.confidence >= 0.5
           AND chain.path NOT LIKE '%' || ce.to_memory_id::TEXT || '%'
       )
       SELECT path, total_uplift, min_confidence
         FROM chain
        WHERE to_id = $3
        ORDER BY total_uplift DESC
        LIMIT 10`,
      [fromMemoryId, maxDepth, toMemoryId],
    );

    const chains = result.rows as Array<{ path: string; total_uplift: number; min_confidence: number }>;

    return chains.map(row => ({
      path: row.path.split('->').map(Number),
      totalUplift: row.total_uplift,
      confidence: row.min_confidence,
    }));
  }

  /**
   * Get causal chain with HyperbolicAttention (v2 feature).
   *
   * Same WITH RECURSIVE port rules as v1; attention re-ranking is pure
   * compute over the row set the query returns.
   */
  private async getCausalChainWithAttention(
    fromMemoryId: number,
    toMemoryId: number,
    maxDepth: number,
  ): Promise<{
    path: number[];
    totalUplift: number;
    confidence: number;
    attentionMetrics: {
      hyperbolicDistance: number[];
      computeTimeMs: number;
    };
  }[]> {
    const candidatesResult = await this.db.query(
      `WITH RECURSIVE chain(from_id, to_id, depth, path, total_uplift, min_confidence) AS (
         SELECT
           from_memory_id,
           to_memory_id,
           1,
           from_memory_id::TEXT || '->' || to_memory_id::TEXT,
           COALESCE(uplift, 0)::REAL,
           confidence
         FROM causal_edges
         WHERE from_memory_id = $1 AND confidence >= 0.5

         UNION ALL

         SELECT
           chain.from_id,
           ce.to_memory_id,
           chain.depth + 1,
           chain.path || '->' || ce.to_memory_id::TEXT,
           chain.total_uplift + COALESCE(ce.uplift, 0)::REAL,
           LEAST(chain.min_confidence, ce.confidence)
         FROM chain
         JOIN causal_edges ce ON chain.to_id = ce.from_memory_id
         WHERE chain.depth < $2
           AND ce.confidence >= 0.5
           AND chain.path NOT LIKE '%' || ce.to_memory_id::TEXT || '%'
       )
       SELECT path, total_uplift, min_confidence
         FROM chain
        WHERE to_id = $3
        LIMIT 50`,
      [fromMemoryId, maxDepth, toMemoryId],
    );
    const candidateChains = candidatesResult.rows as Array<{ path: string; total_uplift: number; min_confidence: number }>;

    if (candidateChains.length === 0) {
      return [];
    }

    const fromEpisodeResult = await this.db.query(
      'SELECT task, output FROM episodes WHERE id = $1',
      [fromMemoryId],
    );
    const fromEpisode = fromEpisodeResult.rows[0] as { task: string; output: string } | undefined;
    const queryText = fromEpisode ? `${fromEpisode.task}: ${fromEpisode.output}` : '';
    const queryEmbedding = await this.embedder!.embed(queryText);

    const allNodeIds = new Set<number>();
    candidateChains.forEach(chain => {
      const path = chain.path.split('->').map(Number);
      path.forEach(id => allNodeIds.add(id));
    });

    const nodeEmbeddings = new Map<number, Float32Array>();
    const hierarchyLevels = new Map<number, number>();

    for (const nodeId of allNodeIds) {
      const episodeResult = await this.db.query(
        'SELECT task, output FROM episodes WHERE id = $1',
        [nodeId],
      );
      const episode = episodeResult.rows[0] as { task: string; output: string } | undefined;
      if (episode) {
        const text = `${episode.task}: ${episode.output}`;
        const embedding = await this.embedder!.embed(text);
        nodeEmbeddings.set(nodeId, embedding);

        const level = candidateChains
          .filter(chain => chain.path.includes(String(nodeId)))
          .reduce((minDepth: number, chain) => {
            const path = chain.path.split('->').map(Number);
            const idx = path.indexOf(nodeId);
            return Math.min(minDepth, idx);
          }, maxDepth);

        hierarchyLevels.set(nodeId, level);
      }
    }

    const dim = getEmbeddingConfig().dimension;
    const nodeList = Array.from(allNodeIds);
    const keys = new Float32Array(nodeList.length * dim);
    const values = new Float32Array(nodeList.length * dim);
    const hierarchyArray: number[] = [];

    nodeList.forEach((nodeId, idx) => {
      const embedding = nodeEmbeddings.get(nodeId)!;
      keys.set(embedding, idx * dim);
      values.set(embedding, idx * dim);
      hierarchyArray.push(hierarchyLevels.get(nodeId) || 0);
    });

    const queries = new Float32Array(dim);
    queries.set(queryEmbedding);

    const attentionResult = await this.attentionService!.hyperbolicAttention(
      queries,
      keys,
      values,
      hierarchyArray,
    );

    const rankedChains = candidateChains
      .map(chain => {
        const path = chain.path.split('->').map(Number);

        const avgWeight = path.reduce((sum: number, nodeId: number) => {
          const idx = nodeList.indexOf(nodeId);
          return sum + (idx >= 0 ? attentionResult.weights[idx] : 0);
        }, 0) / path.length;

        return {
          path,
          totalUplift: chain.total_uplift,
          confidence: chain.min_confidence * avgWeight,
          attentionMetrics: {
            hyperbolicDistance: attentionResult.distances,
            computeTimeMs: attentionResult.metrics.computeTimeMs,
          },
        };
      })
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);

    return rankedChains;
  }

  /**
   * Calculate causal gain: E[outcome|do(treatment)] - E[outcome].
   *
   * Postgres-substrate note: `success` is a BOOLEAN column under postgres
   * (was 0/1 INTEGER under SQLite). The outcome-type CASE arms cast
   * BOOLEAN to numeric explicitly so AVG() returns a comparable REAL
   * regardless of which outcome metric the caller selects.
   */
  async calculateCausalGain(treatmentId: number, outcomeType: 'reward' | 'success' | 'latency'): Promise<{
    causalGain: number;
    confidence: number;
    mechanism: string;
  }> {
    const withTreatmentResult = await this.db.query(
      `SELECT AVG(
                CASE
                  WHEN $1 = 'reward'  THEN reward
                  WHEN $2 = 'success' THEN (CASE WHEN success THEN 1.0 ELSE 0.0 END)
                  WHEN $3 = 'latency' THEN latency_ms
                END
              ) AS avg_outcome
         FROM episodes
        WHERE id IN (
          SELECT to_memory_id FROM causal_edges
           WHERE from_memory_id = $4 AND confidence >= 0.6
        )`,
      [outcomeType, outcomeType, outcomeType, treatmentId],
    );
    const withTreatment = withTreatmentResult.rows[0] as { avg_outcome: number | null } | undefined;

    const baselineResult = await this.db.query(
      `SELECT AVG(
                CASE
                  WHEN $1 = 'reward'  THEN reward
                  WHEN $2 = 'success' THEN (CASE WHEN success THEN 1.0 ELSE 0.0 END)
                  WHEN $3 = 'latency' THEN latency_ms
                END
              ) AS avg_outcome
         FROM episodes
        WHERE id NOT IN (
          SELECT to_memory_id FROM causal_edges
           WHERE from_memory_id = $4
        )`,
      [outcomeType, outcomeType, outcomeType, treatmentId],
    );
    const baseline = baselineResult.rows[0] as { avg_outcome: number | null } | undefined;

    const causalGain = (withTreatment?.avg_outcome || 0) - (baseline?.avg_outcome || 0);

    const edgeResult = await this.db.query(
      `SELECT mechanism, confidence
         FROM causal_edges
        WHERE from_memory_id = $1
        ORDER BY confidence DESC
        LIMIT 1`,
      [treatmentId],
    );
    const edge = edgeResult.rows[0] as { mechanism: string | null; confidence: number } | undefined;

    return {
      causalGain,
      confidence: edge?.confidence || 0,
      mechanism: edge?.mechanism || 'unknown',
    };
  }

  /**
   * Detect confounders using correlation analysis.
   *
   * This is a simplified, fork-internal correlation approximation — same
   * algorithm as the pre-port version; only the SQL substrate moved.
   */
  async detectConfounders(edgeId: number): Promise<{
    confounders: Array<{
      memoryId: number;
      correlationWithTreatment: number;
      correlationWithOutcome: number;
      confounderScore: number;
    }>;
  }> {
    const edgeResult = await this.db.query(
      'SELECT * FROM causal_edges WHERE id = $1',
      [edgeId],
    );
    const edge = edgeResult.rows[0] as any;

    if (!edge) {
      return { confounders: [] };
    }

    const potentialResult = await this.db.query(
      `SELECT DISTINCT e.id, e.task
         FROM episodes e
        WHERE e.id != $1 AND e.id != $2
          AND e.session_id IN (
            SELECT session_id FROM episodes WHERE id = $3
            UNION
            SELECT session_id FROM episodes WHERE id = $4
          )`,
      [edge.from_memory_id, edge.to_memory_id, edge.from_memory_id, edge.to_memory_id],
    );
    const potentialConfounders = potentialResult.rows as Array<{ id: number; task: string }>;

    const confounders: Array<{
      memoryId: number;
      correlationWithTreatment: number;
      correlationWithOutcome: number;
      confounderScore: number;
    }> = [];

    for (const conf of potentialConfounders) {
      const treatmentCorr = await this.calculateCorrelation(conf.id, edge.from_memory_id);
      const outcomeCorr = await this.calculateCorrelation(conf.id, edge.to_memory_id);
      const confounderScore = Math.sqrt(treatmentCorr ** 2 * outcomeCorr ** 2);

      if (confounderScore > 0.3) {
        confounders.push({
          memoryId: conf.id,
          correlationWithTreatment: treatmentCorr,
          correlationWithOutcome: outcomeCorr,
          confounderScore,
        });
      }
    }

    if (confounders.length > 0) {
      const maxConfounderScore = Math.max(...confounders.map(c => c.confounderScore));
      await this.db.query(
        `UPDATE causal_edges
            SET confounder_score = $1
          WHERE id = $2`,
        [maxConfounderScore, edgeId],
      );
    }

    return { confounders };
  }

  // ========================================================================
  // Private Helper Methods
  // ========================================================================

  private rowToCausalEdge(row: {
    id: number | string;
    from_memory_id: number | string;
    from_memory_type: string;
    to_memory_id: number | string;
    to_memory_type: string;
    similarity: number;
    uplift: number | null;
    confidence: number;
    sample_size: number | string | null;
    evidence_ids: string | string[] | null;
    confounder_score: number | null;
    mechanism: string | null;
    metadata: string | Record<string, any> | null;
  }): CausalEdge {
    // pglite returns JSONB columns as parsed objects; postgres TEXT-typed
    // JSON columns come back as strings. Handle both shapes.
    const parseMaybeJson = (val: unknown): Record<string, any> | undefined => {
      if (val == null) return undefined;
      if (typeof val === 'object') return val as Record<string, any>;
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return undefined; }
      }
      return undefined;
    };

    const evidenceIds = row.evidence_ids == null
      ? undefined
      : Array.isArray(row.evidence_ids)
        ? row.evidence_ids
        : typeof row.evidence_ids === 'string'
          ? (() => { try { return JSON.parse(row.evidence_ids as string); } catch { return undefined; } })()
          : undefined;

    return {
      id: Number(row.id),
      fromMemoryId: Number(row.from_memory_id),
      fromMemoryType: row.from_memory_type as 'episode' | 'skill' | 'note' | 'fact',
      toMemoryId: Number(row.to_memory_id),
      toMemoryType: row.to_memory_type as 'episode' | 'skill' | 'note' | 'fact',
      similarity: row.similarity,
      uplift: row.uplift ?? undefined,
      confidence: row.confidence,
      sampleSize: row.sample_size == null ? undefined : Number(row.sample_size),
      evidenceIds,
      experimentIds: undefined,
      confounderScore: row.confounder_score ?? undefined,
      mechanism: row.mechanism ?? undefined,
      metadata: parseMaybeJson(row.metadata),
    };
  }

  private mean(values: number[]): number {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private variance(values: number[]): number {
    const avg = this.mean(values);
    return values.reduce((sum, val) => sum + (val - avg) ** 2, 0) / values.length;
  }

  private standardError(values: number[]): number {
    return Math.sqrt(this.variance(values) / values.length);
  }

  private tCDF(t: number, df: number): number {
    return 0.5 + 0.5 * Math.sign(t) * (1 - Math.pow(1 + t * t / df, -df / 2));
  }

  private tInverse(_p: number, _df: number): number {
    return 1.96;
  }

  private async calculateCorrelation(id1: number, id2: number): Promise<number> {
    const result = await this.db.query(
      `SELECT COUNT(DISTINCT e1.session_id) AS shared
         FROM episodes e1
         JOIN episodes e2 ON e1.session_id = e2.session_id
        WHERE e1.id = $1 AND e2.id = $2`,
      [id1, id2],
    );
    const row = result.rows[0] as { shared: number | string } | undefined;
    const shared = row ? Number(row.shared) : 0;
    return Math.min(shared, 1.0);
  }
}
