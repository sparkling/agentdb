/**
 * CausalRecall - Utility-Based Reranking + Certificate Issuer
 *
 * Combines:
 * 1. Vector similarity search
 * 2. Causal uplift from CausalMemoryGraph
 * 3. Utility-based reranking: U = α*similarity + β*uplift − γ*latencyCost
 * 4. Automatic certificate issuance via ExplainableRecall
 *
 * This is the main entry point for production retrieval with:
 * - Causal-aware ranking
 * - Explainable provenance
 * - Policy compliance
 *
 * ADR-0170 Phase B.11 port (2026-05-11):
 *   - PostgreSQL substrate via PostgresBackend (pglite embedded or postgres://server)
 *   - All DB-touching methods (vectorSearch / loadCausalEdges / getStats /
 *     recall / search / batchRecall) are async; SQL placeholders are `$N`
 *     not `?`.
 *   - JOIN against `causal_edges` (CausalMemoryGraph's table — Wave 1a port)
 *     reads BIGINT ids back as string|number from pg; the loadCausalEdges
 *     row-mapping normalizes via `Number(...)`.
 *   - `episode_embeddings.embedding` stays BYTEA in Phase B; pg returns it
 *     as a Buffer just like better-sqlite3, so deserializeEmbedding is
 *     unchanged.
 *   - The constructor's optional `causalGraph` / `explainableRecall`
 *     injection now expects postgres-backed singletons; the lazy
 *     `new CausalMemoryGraph(db)` / `new ExplainableRecall(db)` fallbacks
 *     forward the PostgresBackend handle directly (both controllers were
 *     ported earlier in Wave 1a/1b).
 */

import { CausalMemoryGraph, CausalEdge } from './CausalMemoryGraph.js';
import { ExplainableRecall, RecallCertificate } from './ExplainableRecall.js';
import { EmbeddingService } from './EmbeddingService.js';
import type { PostgresBackend } from '../backends/postgres/PostgresBackend.js';
import { embeddingToVector } from '../backends/postgres/PostgresBackend.js';
import type { VectorBackend } from '../backends/VectorBackend.js';

export interface RerankConfig {
  alpha: number; // Similarity weight (default: 0.7)
  beta: number;  // Uplift weight (default: 0.2)
  gamma: number; // Latency penalty (default: 0.1)
  minConfidence?: number; // Min causal confidence (default: 0.6)
}

export interface RerankCandidate {
  id: string;
  type: 'episode' | 'skill' | 'note' | 'fact';
  content: string;
  similarity: number;
  uplift?: number;
  causalConfidence?: number;
  latencyMs?: number;
  utilityScore: number;
  rank: number;
}

export interface CausalRecallResult {
  candidates: RerankCandidate[];
  certificate: RecallCertificate;
  queryId: string;
  totalLatencyMs: number;
  metrics: {
    vectorSearchMs: number;
    causalLookupMs: number;
    rerankMs: number;
    certificateMs: number;
  };
}

export class CausalRecall {
  private db: PostgresBackend;
  private causalGraph: CausalMemoryGraph;
  private explainableRecall: ExplainableRecall;
  private embedder: EmbeddingService;
  private vectorBackend?: VectorBackend;

  constructor(
    db: PostgresBackend,
    embedder: EmbeddingService,
    vectorBackend?: VectorBackend,
    private config: RerankConfig = {
      alpha: 0.7,
      beta: 0.2,
      gamma: 0.1,
      minConfidence: 0.6
    },
    causalGraph?: CausalMemoryGraph,
    explainableRecall?: ExplainableRecall,
  ) {
    this.db = db;
    this.embedder = embedder;
    this.vectorBackend = vectorBackend;
    // ADR-0040: accept pre-created singletons to avoid duplicate instances
    this.causalGraph = causalGraph || new CausalMemoryGraph(db);
    this.explainableRecall = explainableRecall || new ExplainableRecall(db);
  }

  /**
   * Main recall function with utility-based reranking and certificate issuance
   *
   * @param queryId Unique query identifier
   * @param queryText Natural language query
   * @param k Number of results to return (default: 12)
   * @param requirements Optional list of requirements for completeness checking
   * @param accessLevel Security access level for certificate
   * @returns Reranked results with certificate
   */
  async recall(
    queryId: string,
    queryText: string,
    k: number = 12,
    requirements?: string[],
    accessLevel: 'public' | 'internal' | 'confidential' | 'restricted' = 'internal'
  ): Promise<CausalRecallResult> {
    const startTime = Date.now();
    const metrics = {
      vectorSearchMs: 0,
      causalLookupMs: 0,
      rerankMs: 0,
      certificateMs: 0
    };

    // Step 1: Vector similarity search
    const vectorStart = Date.now();
    const queryEmbedding = await this.embedder.embed(queryText);
    const candidates = await this.vectorSearch(queryEmbedding, k * 2); // Fetch 2k for reranking
    metrics.vectorSearchMs = Date.now() - vectorStart;

    // Step 2: Load causal edges for candidates
    const causalStart = Date.now();
    const causalEdges = await this.loadCausalEdges(candidates.map(c => c.id));
    metrics.causalLookupMs = Date.now() - causalStart;

    // Step 3: Rerank by utility
    const rerankStart = Date.now();
    const reranked = this.rerankByUtility(candidates, causalEdges);
    const topK = reranked.slice(0, k);
    metrics.rerankMs = Date.now() - rerankStart;

    // Step 4: Issue certificate
    const certStart = Date.now();
    const certificate = await this.issueCertificate({
      queryId,
      queryText,
      candidates: topK,
      requirements: requirements || this.extractRequirements(queryText),
      accessLevel
    });
    metrics.certificateMs = Date.now() - certStart;

    const totalLatencyMs = Date.now() - startTime;

    return {
      candidates: topK,
      certificate,
      queryId,
      totalLatencyMs,
      metrics
    };
  }

  /**
   * Vector similarity search using cosine similarity.
   *
   * Postgres-substrate note: when no VectorBackend is plugged in, we read
   * BYTEA embeddings out of `episode_embeddings` and compute cosine in
   * application code. Phase C lights up pgvector and pushes this into the
   * planner. BIGINT ids round-trip through `Number()` because pg can
   * return them as strings depending on parser config.
   */
  private async vectorSearch(
    queryEmbedding: Float32Array,
    k: number
  ): Promise<Array<{ id: string; type: string; content: string; similarity: number; latencyMs: number }>> {
    // ADR-0170 Phase C.1: pgvector HNSW k-NN. The legacy vectorBackend
    // branch is retired — single SQL plan, single index. `<=>` is cosine
    // distance; similarity = 1 - distance.
    const episodesResult = await this.db.query(
      `SELECT
         e.id,
         'episode' AS type,
         e.task || ' ' || COALESCE(e.output, '') AS content,
         e.latency_ms,
         ee.embedding <=> $1::vector AS distance
       FROM episodes e
       JOIN episode_embeddings ee ON e.id = ee.episode_id
       WHERE ee.embedding IS NOT NULL
       ORDER BY ee.embedding <=> $1::vector
       LIMIT $2`,
      [embeddingToVector(queryEmbedding), k],
    );
    const episodes = episodesResult.rows as Array<{
      id: number | string;
      type: string;
      content: string;
      latency_ms: number | string | null;
      distance: number;
    }>;

    return episodes.map((ep) => ({
      id: String(ep.id),
      type: ep.type,
      content: ep.content,
      similarity: 1 - Number(ep.distance),
      latencyMs: ep.latency_ms == null ? 0 : Number(ep.latency_ms),
    }));
  }

  /**
   * Load causal edges for candidates.
   *
   * Postgres-substrate note: `causal_edges` is the table CausalMemoryGraph
   * (Wave 1a) owns. BIGINT id columns come back as string|number from pg
   * depending on the parser; normalize via `Number(...)` so the
   * `Map<string, CausalEdge[]>` keys stay consistent with the candidate
   * id shape (`String(...)`).
   */
  private async loadCausalEdges(candidateIds: string[]): Promise<Map<string, CausalEdge[]>> {
    const edgeMap = new Map<string, CausalEdge[]>();

    if (candidateIds.length === 0) {
      return edgeMap;
    }

    // $1..$N for the IN-list, then $N+1 for the confidence threshold.
    const placeholders = candidateIds.map((_, i) => `$${i + 1}`).join(',');
    const minConfidenceParam = `$${candidateIds.length + 1}`;
    const params = [
      ...candidateIds.map(id => parseInt(id, 10)),
      this.config.minConfidence || 0.6,
    ];

    const edgesResult = await this.db.query(
      `SELECT * FROM causal_edges
        WHERE from_memory_id IN (${placeholders})
          AND confidence >= ${minConfidenceParam}`,
      params,
    );
    const edges = edgesResult.rows as Array<{
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
      mechanism: string | null;
    }>;

    for (const edge of edges) {
      const fromId = String(edge.from_memory_id);
      if (!edgeMap.has(fromId)) {
        edgeMap.set(fromId, []);
      }
      // pglite returns JSONB columns as parsed values; TEXT-typed JSON
      // arrives as a string. Tolerate both for evidence_ids.
      let evidenceIds: string[] | undefined;
      if (edge.evidence_ids == null) {
        evidenceIds = undefined;
      } else if (Array.isArray(edge.evidence_ids)) {
        evidenceIds = edge.evidence_ids;
      } else if (typeof edge.evidence_ids === 'string') {
        try { evidenceIds = JSON.parse(edge.evidence_ids); } catch { evidenceIds = undefined; }
      }
      edgeMap.get(fromId)!.push({
        id: Number(edge.id),
        fromMemoryId: Number(edge.from_memory_id),
        fromMemoryType: edge.from_memory_type as CausalEdge['fromMemoryType'],
        toMemoryId: Number(edge.to_memory_id),
        toMemoryType: edge.to_memory_type as CausalEdge['toMemoryType'],
        similarity: edge.similarity,
        uplift: edge.uplift ?? undefined,
        confidence: edge.confidence,
        sampleSize: edge.sample_size == null ? undefined : Number(edge.sample_size),
        evidenceIds,
        mechanism: edge.mechanism ?? undefined,
      });
    }

    return edgeMap;
  }

  /**
   * Rerank by utility: U = α*similarity + β*uplift − γ*latencyCost
   */
  private rerankByUtility(
    candidates: Array<{ id: string; type: string; content: string; similarity: number; latencyMs: number }>,
    causalEdges: Map<string, CausalEdge[]>
  ): RerankCandidate[] {
    const { alpha, beta, gamma } = this.config;

    const reranked = candidates.map(candidate => {
      // Get causal uplift (average if multiple edges)
      const edges = causalEdges.get(candidate.id) || [];
      const avgUplift = edges.length > 0
        ? edges.reduce((sum, e) => sum + (e.uplift || 0), 0) / edges.length
        : 0;

      const avgConfidence = edges.length > 0
        ? edges.reduce((sum, e) => sum + e.confidence, 0) / edges.length
        : 0;

      // Normalize latency (assume max 1000ms)
      const latencyCost = Math.min(candidate.latencyMs / 1000, 1.0);

      // Calculate utility
      const utilityScore = alpha * candidate.similarity + beta * avgUplift - gamma * latencyCost;

      return {
        id: candidate.id,
        type: candidate.type as any,
        content: candidate.content,
        similarity: candidate.similarity,
        uplift: avgUplift,
        causalConfidence: avgConfidence,
        latencyMs: candidate.latencyMs,
        utilityScore,
        rank: 0 // Will be set after sorting
      };
    });

    // Sort by utility score descending
    reranked.sort((a, b) => b.utilityScore - a.utilityScore);

    // Assign ranks
    reranked.forEach((candidate, idx) => {
      candidate.rank = idx + 1;
    });

    return reranked;
  }

  /**
   * Issue certificate for the retrieval
   */
  private async issueCertificate(params: {
    queryId: string;
    queryText: string;
    candidates: RerankCandidate[];
    requirements: string[];
    accessLevel: 'public' | 'internal' | 'confidential' | 'restricted';
  }): Promise<RecallCertificate> {
    const { queryId, queryText, candidates, requirements, accessLevel } = params;

    const chunks = candidates.map(c => ({
      id: c.id,
      type: c.type,
      content: c.content,
      relevance: c.similarity
    }));

    return await this.explainableRecall.createCertificate({
      queryId,
      queryText,
      chunks,
      requirements,
      accessLevel
    });
  }

  /**
   * Extract requirements from query text (simple keyword extraction)
   */
  private extractRequirements(queryText: string): string[] {
    // Simple extraction: split on common words and filter
    const stopWords = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'to', 'from', 'for', 'with', 'how', 'what', 'where', 'when', 'why', 'who']);

    const words = queryText
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    // Return unique words
    return [...new Set(words)];
  }

  // ADR-0170 Phase C.1: deserializeEmbedding retired — vectors live as
  // pgvector columns; reads go through vectorToEmbedding() when needed.

  /**
   * Batch recall for multiple queries
   */
  async batchRecall(
    queries: Array<{ queryId: string; queryText: string; k?: number }>,
    requirements?: string[],
    accessLevel: 'public' | 'internal' | 'confidential' | 'restricted' = 'internal'
  ): Promise<CausalRecallResult[]> {
    const results: CausalRecallResult[] = [];

    for (const query of queries) {
      const result = await this.recall(
        query.queryId,
        query.queryText,
        query.k || 12,
        requirements,
        accessLevel
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Get recall statistics.
   *
   * Postgres-substrate note: AVG() returns NUMERIC under postgres (was
   * REAL under SQLite). pg returns NUMERIC as string by default, so the
   * avg_redundancy / avg_completeness columns are normalized through
   * `Number(...)` to keep the public return type stable.
   */
  async getStats(): Promise<{
    totalCausalEdges: number;
    totalCertificates: number;
    avgRedundancyRatio: number;
    avgCompletenessScore: number;
  }> {
    const causalEdgesResult = await this.db.query(
      'SELECT COUNT(*) AS count FROM causal_edges',
    );
    const certificatesResult = await this.db.query(
      'SELECT COUNT(*) AS count FROM recall_certificates',
    );
    const avgStatsResult = await this.db.query(
      `SELECT
         AVG(redundancy_ratio)   AS avg_redundancy,
         AVG(completeness_score) AS avg_completeness
       FROM recall_certificates`,
    );

    const causalEdges = causalEdgesResult.rows[0] as { count: number | string } | undefined;
    const certificates = certificatesResult.rows[0] as { count: number | string } | undefined;
    const avgStats = avgStatsResult.rows[0] as {
      avg_redundancy: number | string | null;
      avg_completeness: number | string | null;
    } | undefined;

    return {
      totalCausalEdges: causalEdges ? Number(causalEdges.count) : 0,
      totalCertificates: certificates ? Number(certificates.count) : 0,
      avgRedundancyRatio: avgStats?.avg_redundancy == null ? 0 : Number(avgStats.avg_redundancy),
      avgCompletenessScore: avgStats?.avg_completeness == null ? 0 : Number(avgStats.avg_completeness),
    };
  }

  /**
   * Update rerank configuration
   */
  updateConfig(config: Partial<RerankConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Search for memories with semantic similarity and causal utility ranking
   *
   * @param params Search parameters
   * @returns Array of ranked search results with similarity and causal uplift scores
   */
  async search(params: {
    query: string;
    k?: number;
    includeEvidence?: boolean;
    alpha?: number;
    beta?: number;
    gamma?: number;
  }): Promise<Array<{
    id: number;
    type: string;
    content: string;
    similarity: number;
    causalUplift: number;
    utilityScore: number;
  }>> {
    const {
      query,
      k = 12,
      alpha = this.config.alpha,
      beta = this.config.beta,
      gamma = this.config.gamma
    } = params;

    // Temporarily override config for this search
    const originalConfig = { ...this.config };
    this.config = { ...this.config, alpha, beta, gamma };

    try {
      // Step 1: Generate query embedding
      const queryEmbedding = await this.embedder.embed(query);

      // Step 2: Vector similarity search
      const candidates = await this.vectorSearch(queryEmbedding, k * 2);

      // Step 3: Load causal edges for uplift scoring
      const causalEdges = await this.loadCausalEdges(candidates.map(c => c.id));

      // Step 4: Rerank by utility
      const reranked = this.rerankByUtility(candidates, causalEdges);

      // Step 5: Format results for search interface
      const results = reranked.slice(0, k).map(candidate => ({
        id: parseInt(candidate.id, 10),
        type: candidate.type,
        content: candidate.content,
        similarity: candidate.similarity,
        causalUplift: candidate.uplift || 0,
        utilityScore: candidate.utilityScore
      }));

      return results;
    } finally {
      // Restore original config
      this.config = originalConfig;
    }
  }
}
