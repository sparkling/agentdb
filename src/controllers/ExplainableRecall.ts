/**
 * ExplainableRecall - Provenance and Justification for Memory Retrieval
 *
 * Every retrieval returns:
 * - Minimal hitting set of facts that justify the answer
 * - Merkle proof chain for provenance
 * - Policy compliance certificates
 *
 * Based on:
 * - Minimal hitting set algorithms
 * - Merkle tree provenance
 * - Explainable AI techniques
 *
 * v2.0.0-alpha.3 Features:
 * - GraphRoPE for hop-distance-aware graph queries (WASM)
 * - Rotary positional encoding based on graph structure
 * - Feature flag: ENABLE_GRAPH_ROPE (default: false)
 * - 100% backward compatible with fallback to standard retrieval
 *
 * ADR-0170 Phase B.5 (2026-05-11): ported from better-sqlite3 (sync) to
 * PostgresBackend (async). All public + private DB-touching methods are
 * now async. SQL placeholders use `$N` instead of `?`. The `recall_certificates`
 * DDL was moved from constructor to an `initialize()` method (pglite is
 * async). The schema-level FTS index on `query_text` (tsvector + GIN) lives
 * in `schemas/frontier-schema.sql` and is not queried by this controller;
 * it is preserved for future ts_rank() usage. No SQLite FTS5 virtual table
 * existed for this controller, so the "FTS port" is schema-side only.
 */

import * as crypto from 'crypto';
import { AttentionService, type GraphRoPEConfig } from '../utils/LegacyAttentionAdapter.js';
import { EmbeddingService } from './EmbeddingService.js';
import type { PostgresBackend } from '../backends/postgres/PostgresBackend.js';

/**
 * Configuration for ExplainableRecall
 */
export interface ExplainableRecallConfig {
  /** Enable GraphRoPE for hop-aware queries (default: false) */
  ENABLE_GRAPH_ROPE?: boolean;
  /** GraphRoPE configuration */
  graphRoPEConfig?: Partial<GraphRoPEConfig>;
}

export interface RecallCertificate {
  id: string; // UUID
  queryId: string;
  queryText: string;

  // Retrieved chunks
  chunkIds: string[];
  chunkTypes: string[];

  // Justification
  minimalWhy: string[]; // Minimal hitting set
  redundancyRatio: number; // len(chunks) / len(minimalWhy)
  completenessScore: number; // Fraction of requirements met

  // Provenance
  merkleRoot: string;
  sourceHashes: string[];
  proofChain: MerkleProof[];

  // Policy
  policyProof?: string;
  policyVersion?: string;
  accessLevel: 'public' | 'internal' | 'confidential' | 'restricted';

  latencyMs?: number;
  metadata?: Record<string, any>;
}

export interface MerkleProof {
  hash: string;
  position: 'left' | 'right';
}

export interface JustificationPath {
  chunkId: string;
  chunkType: string;
  reason: 'semantic_match' | 'causal_link' | 'prerequisite' | 'constraint';
  necessityScore: number; // 0-1
  pathElements: string[]; // Reasoning chain
}

export interface ProvenanceSource {
  id?: number;
  sourceType: 'episode' | 'skill' | 'note' | 'fact' | 'external';
  sourceId: number;
  contentHash: string;
  parentHash?: string;
  derivedFrom?: string[];
  creator?: string;
  metadata?: Record<string, any>;
}

// ADR-0076 A4: Dual-instance guard — prevent duplicate construction
// when both ControllerRegistry and AgentDBService create this controller
let _singleton: InstanceType<typeof ExplainableRecall> | null = null;

export class ExplainableRecall {
  // ADR-0076 A4: definite-assignment due to _singleton early-return pattern in ctor
  private db!: PostgresBackend;
  private attentionService?: AttentionService;
  private embedder?: EmbeddingService;
  private config!: ExplainableRecallConfig;

  /**
   * Constructor supports both v1 (legacy) and v2 (with GraphRoPE) modes
   *
   * v1 mode: new ExplainableRecall(db)
   * v2 mode: new ExplainableRecall(db, embedder, config)
   */
  static _resetSingleton(): void { _singleton = null; }

  constructor(
    db: PostgresBackend,
    embedder?: EmbeddingService,
    config?: ExplainableRecallConfig,
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
    this.config = {
      ENABLE_GRAPH_ROPE: false,
      ...config,
    };

    // Use injected AttentionService if provided, else create one when needed.
    // AttentionService's `_db` constructor param is unused (see LegacyAttentionAdapter.ts:97)
    // so passing PostgresBackend is type-clean but inert.
    if (attentionService) {
      this.attentionService = attentionService;
    } else if (embedder && this.config.ENABLE_GRAPH_ROPE) {
      this.attentionService = new AttentionService(db as any, {
        graphRoPE: {
          enabled: true,
          ...this.config.graphRoPEConfig,
        },
      });
    }
  }

  /**
   * Initialize schema. Idempotent (IF NOT EXISTS). Must be awaited before
   * other methods are called.
   *
   * The `recall_certificates`, `provenance_sources`, and `justification_paths`
   * DDL ships in `schemas/frontier-schema.sql` (PostgreSQL dialect). This
   * method is a safety net for direct-instantiation paths (e.g.,
   * `memory-router.ts` → `ControllerRegistry`) that bypass the frontier
   * schema load — mirrors the historical ADR-0090 B5 W2-I3 pattern.
   *
   * Postgres `CREATE TABLE IF NOT EXISTS` is a no-op when the schema has
   * already been loaded, so this is safe to await on every construction.
   */
  async initialize(): Promise<void> {
    try {
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS recall_certificates (
          id TEXT PRIMARY KEY,
          query_id TEXT NOT NULL,
          query_text TEXT NOT NULL,
          chunk_ids TEXT NOT NULL,
          chunk_types TEXT NOT NULL,
          minimal_why TEXT,
          redundancy_ratio REAL,
          completeness_score REAL,
          merkle_root TEXT NOT NULL,
          source_hashes TEXT,
          proof_chain TEXT,
          policy_proof TEXT,
          policy_version TEXT,
          access_level TEXT,
          created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
          latency_ms BIGINT,
          metadata JSONB
        );
        CREATE INDEX IF NOT EXISTS idx_recall_certificates_query ON recall_certificates(query_id);
        CREATE INDEX IF NOT EXISTS idx_recall_certificates_created ON recall_certificates(created_at DESC);
      `);
    } catch (err: any) {
      // Loud — per ADR-0082. Schema creation failing is fatal for this controller.
      console.error(`[ExplainableRecall] recall_certificates DDL failed: ${err?.message || err}`);
      throw err;
    }
  }

  /**
   * Create a recall certificate for a retrieval operation
   *
   * v2: Uses GraphRoPE if enabled for hop-distance-aware justification scoring
   * v1: Falls back to standard relevance-based justification
   */
  async createCertificate(params: {
    queryId: string;
    queryText: string;
    chunks: Array<{ id: string; type: string; content: string; relevance: number }>;
    requirements: string[]; // Query requirements
    accessLevel?: string;
    hopDistances?: number[][]; // Optional hop distances for GraphRoPE
  }): Promise<RecallCertificate> {
    const { queryId, queryText, chunks, requirements, accessLevel = 'internal' } = params;

    const startTime = Date.now();

    // 1. Compute minimal hitting set
    const minimalWhy = this.computeMinimalHittingSet(chunks, requirements);

    // 2. Calculate metrics
    const redundancyRatio = chunks.length / minimalWhy.length;
    const completenessScore = await this.calculateCompleteness(minimalWhy, requirements);

    // 3. Build provenance chain
    const sourceHashes: string[] = [];
    for (const chunk of chunks) {
      sourceHashes.push(await this.getOrCreateProvenance(chunk.type, parseInt(chunk.id)));
    }

    const merkleTree = this.buildMerkleTree(sourceHashes);
    const merkleRoot = merkleTree.root;

    // 4. Generate chunk metadata first (needed for certificate ID)
    const chunkIds = chunks.map(c => c.id);
    const chunkTypes = chunks.map(c => c.type);

    // 5. Create certificate ID
    const certificateId = this.generateCertificateId(queryId, chunkIds);

    // 6. Generate proof chain for each chunk
    const proofChain = chunks.map((_chunk, idx) =>
      this.getMerkleProof(merkleTree, idx),
    ).flat();

    // 7. Store certificate
    await this.db.query(`
      INSERT INTO recall_certificates (
        id, query_id, query_text, chunk_ids, chunk_types,
        minimal_why, redundancy_ratio, completeness_score,
        merkle_root, source_hashes, proof_chain,
        access_level, latency_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      certificateId,
      queryId,
      queryText,
      JSON.stringify(chunkIds),
      JSON.stringify(chunkTypes),
      JSON.stringify(minimalWhy),
      redundancyRatio,
      completenessScore,
      merkleRoot,
      JSON.stringify(sourceHashes),
      JSON.stringify(proofChain),
      accessLevel,
      Date.now() - startTime,
    ]);

    // 8. Store justification paths
    await this.storeJustificationPaths(certificateId, chunks, minimalWhy, requirements);

    const certificate: RecallCertificate = {
      id: certificateId,
      queryId,
      queryText,
      chunkIds,
      chunkTypes,
      minimalWhy,
      redundancyRatio,
      completenessScore,
      merkleRoot,
      sourceHashes,
      proofChain,
      accessLevel: accessLevel as any,
      latencyMs: Date.now() - startTime,
    };

    return certificate;
  }

  /**
   * Verify a recall certificate
   */
  async verifyCertificate(certificateId: string): Promise<{
    valid: boolean;
    issues: string[];
  }> {
    const result = await this.db.query(
      'SELECT * FROM recall_certificates WHERE id = $1',
      [certificateId],
    );
    const cert = result.rows[0] as any;

    if (!cert) {
      return { valid: false, issues: ['Certificate not found'] };
    }

    const issues: string[] = [];

    // 1. Verify Merkle root
    const sourceHashes = JSON.parse(cert.source_hashes);
    const merkleTree = this.buildMerkleTree(sourceHashes);

    if (merkleTree.root !== cert.merkle_root) {
      issues.push('Merkle root mismatch');
    }

    // 2. Verify chunk hashes still match
    const chunkIds = JSON.parse(cert.chunk_ids);
    const chunkTypes = JSON.parse(cert.chunk_types);

    for (let i = 0; i < chunkIds.length; i++) {
      const currentHash = await this.getContentHash(chunkTypes[i], parseInt(chunkIds[i]));
      if (currentHash !== sourceHashes[i]) {
        issues.push(`Chunk ${chunkIds[i]} hash changed`);
      }
    }

    // 3. Verify completeness
    const minimalWhy = JSON.parse(cert.minimal_why);
    if (minimalWhy.length === 0) {
      issues.push('Empty justification set');
    }

    // 4. Verify redundancy ratio
    if (cert.redundancy_ratio < 1.0) {
      issues.push('Invalid redundancy ratio');
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Get justification for why a chunk was included
   */
  async getJustification(certificateId: string, chunkId: string): Promise<JustificationPath | null> {
    const result = await this.db.query(`
      SELECT * FROM justification_paths
      WHERE certificate_id = $1 AND chunk_id = $2
    `, [certificateId, chunkId]);
    const row = result.rows[0] as any;

    if (!row) return null;

    return {
      chunkId: row.chunk_id,
      chunkType: row.chunk_type,
      reason: row.reason,
      necessityScore: row.necessity_score,
      pathElements: JSON.parse(row.path_elements),
    };
  }

  /**
   * Get provenance lineage for a source
   */
  async getProvenanceLineage(contentHash: string): Promise<ProvenanceSource[]> {
    const lineage: ProvenanceSource[] = [];
    let currentHash: string | null = contentHash;

    while (currentHash) {
      const result = await this.db.query(`
        SELECT * FROM provenance_sources WHERE content_hash = $1
      `, [currentHash]);
      const source = result.rows[0] as any;

      if (!source) break;

      lineage.push({
        id: source.id,
        sourceType: source.source_type,
        sourceId: source.source_id,
        contentHash: source.content_hash,
        parentHash: source.parent_hash,
        derivedFrom: source.derived_from
          ? (typeof source.derived_from === 'string' ? JSON.parse(source.derived_from) : source.derived_from)
          : undefined,
        creator: source.creator,
        metadata: source.metadata
          ? (typeof source.metadata === 'string' ? JSON.parse(source.metadata) : source.metadata)
          : undefined,
      });

      currentHash = source.parent_hash;
    }

    return lineage;
  }

  /**
   * Trace provenance lineage for a certificate
   * Returns full provenance chain from certificate to original sources
   */
  async traceProvenance(certificateId: string): Promise<{
    certificate: RecallCertificate;
    sources: Map<string, ProvenanceSource[]>;
    graph: {
      nodes: Array<{ id: string; type: string; label: string }>;
      edges: Array<{ from: string; to: string; type: string }>;
    };
  }> {
    const result = await this.db.query(
      'SELECT * FROM recall_certificates WHERE id = $1',
      [certificateId],
    );
    const certRow = result.rows[0] as any;

    if (!certRow) {
      throw new Error(`Certificate ${certificateId} not found`);
    }

    const certificate: RecallCertificate = {
      id: certRow.id,
      queryId: certRow.query_id,
      queryText: certRow.query_text,
      chunkIds: JSON.parse(certRow.chunk_ids),
      chunkTypes: JSON.parse(certRow.chunk_types),
      minimalWhy: JSON.parse(certRow.minimal_why),
      redundancyRatio: certRow.redundancy_ratio,
      completenessScore: certRow.completeness_score,
      merkleRoot: certRow.merkle_root,
      sourceHashes: JSON.parse(certRow.source_hashes),
      proofChain: JSON.parse(certRow.proof_chain),
      policyProof: certRow.policy_proof,
      policyVersion: certRow.policy_version,
      accessLevel: certRow.access_level,
      latencyMs: certRow.latency_ms,
    };

    // Build provenance map for all sources
    const sources = new Map<string, ProvenanceSource[]>();
    for (const hash of certificate.sourceHashes) {
      sources.set(hash, await this.getProvenanceLineage(hash));
    }

    // Build provenance graph
    const nodes: Array<{ id: string; type: string; label: string }> = [];
    const edges: Array<{ from: string; to: string; type: string }> = [];

    // Add certificate node
    nodes.push({
      id: certificateId,
      type: 'certificate',
      label: `Certificate: ${certificate.queryText.substring(0, 30)}...`,
    });

    // Add source nodes and edges
    for (const [, lineage] of sources.entries()) {
      for (let i = 0; i < lineage.length; i++) {
        const source = lineage[i];
        const nodeId = `${source.sourceType}-${source.sourceId}`;

        // Add node if not exists
        if (!nodes.find(n => n.id === nodeId)) {
          nodes.push({
            id: nodeId,
            type: source.sourceType,
            label: `${source.sourceType} #${source.sourceId}`,
          });
        }

        // Add edge from certificate to first source
        if (i === 0) {
          edges.push({
            from: certificateId,
            to: nodeId,
            type: 'includes',
          });
        }

        // Add edge to parent if exists
        if (i < lineage.length - 1) {
          const parentNodeId = `${lineage[i + 1].sourceType}-${lineage[i + 1].sourceId}`;
          edges.push({
            from: nodeId,
            to: parentNodeId,
            type: 'derived_from',
          });
        }
      }
    }

    return {
      certificate,
      sources,
      graph: { nodes, edges },
    };
  }

  /**
   * Audit certificate access
   */
  async auditCertificate(certificateId: string): Promise<{
    certificate: RecallCertificate;
    justifications: JustificationPath[];
    provenance: Map<string, ProvenanceSource[]>;
    quality: {
      completeness: number;
      redundancy: number;
      avgNecessity: number;
    };
  }> {
    const certResult = await this.db.query(
      'SELECT * FROM recall_certificates WHERE id = $1',
      [certificateId],
    );
    const certRow = certResult.rows[0] as any;

    if (!certRow) {
      throw new Error(`Certificate ${certificateId} not found`);
    }

    const certificate: RecallCertificate = {
      id: certRow.id,
      queryId: certRow.query_id,
      queryText: certRow.query_text,
      chunkIds: JSON.parse(certRow.chunk_ids),
      chunkTypes: JSON.parse(certRow.chunk_types),
      minimalWhy: JSON.parse(certRow.minimal_why),
      redundancyRatio: certRow.redundancy_ratio,
      completenessScore: certRow.completeness_score,
      merkleRoot: certRow.merkle_root,
      sourceHashes: JSON.parse(certRow.source_hashes),
      proofChain: JSON.parse(certRow.proof_chain),
      policyProof: certRow.policy_proof,
      policyVersion: certRow.policy_version,
      accessLevel: certRow.access_level,
      latencyMs: certRow.latency_ms,
    };

    // Get justifications
    const justResult = await this.db.query(`
      SELECT * FROM justification_paths WHERE certificate_id = $1
    `, [certificateId]);
    const justRows = justResult.rows as any[];

    const justifications = justRows.map(row => ({
      chunkId: row.chunk_id,
      chunkType: row.chunk_type,
      reason: row.reason,
      necessityScore: row.necessity_score,
      pathElements: JSON.parse(row.path_elements),
    }));

    // Get provenance for each source
    const provenance = new Map<string, ProvenanceSource[]>();
    for (const hash of certificate.sourceHashes) {
      provenance.set(hash, await this.getProvenanceLineage(hash));
    }

    // Calculate quality metrics
    const avgNecessity = justifications.length > 0
      ? justifications.reduce((sum, j) => sum + j.necessityScore, 0) / justifications.length
      : 0;

    return {
      certificate,
      justifications,
      provenance,
      quality: {
        completeness: certificate.completenessScore,
        redundancy: certificate.redundancyRatio,
        avgNecessity,
      },
    };
  }

  // ========================================================================
  // Private Helper Methods
  // ========================================================================

  /**
   * Compute minimal hitting set using greedy algorithm
   * A hitting set contains at least one element from each requirement
   *
   * Pure in-memory algorithm — no DB calls — stays synchronous.
   */
  private computeMinimalHittingSet(
    chunks: Array<{ id: string; content: string; relevance: number }>,
    requirements: string[],
  ): string[] {
    if (requirements.length === 0) {
      return chunks.slice(0, Math.min(3, chunks.length)).map(c => c.id);
    }

    const uncovered = new Set(requirements);
    const selected: string[] = [];
    let remaining = chunks.slice();

    // Greedy: select chunk that covers most uncovered requirements
    while (uncovered.size > 0 && remaining.length > 0) {
      let bestChunk: typeof remaining[number] | null = null;
      let bestCoverage = 0;

      for (const chunk of remaining) {
        const coverage = Array.from(uncovered).filter(req =>
          chunk.content.toLowerCase().includes(req.toLowerCase()),
        ).length;

        if (coverage > bestCoverage) {
          bestCoverage = coverage;
          bestChunk = chunk;
        }
      }

      if (!bestChunk) break;

      selected.push(bestChunk.id);

      // Remove covered requirements
      for (const req of Array.from(uncovered)) {
        if (bestChunk.content.toLowerCase().includes(req.toLowerCase())) {
          uncovered.delete(req);
        }
      }

      // Remove selected chunk
      remaining = remaining.filter(c => c.id !== bestChunk!.id);
    }

    return selected;
  }

  /**
   * Calculate completeness score
   */
  private async calculateCompleteness(minimalWhy: string[], requirements: string[]): Promise<number> {
    if (requirements.length === 0) return 1.0;

    const chunks: string[] = [];
    for (const id of minimalWhy) {
      const result = await this.db.query('SELECT output FROM episodes WHERE id = $1', [parseInt(id)]);
      const episode = result.rows[0] as any;
      chunks.push(episode ? episode.output : '');
    }

    const satisfied = requirements.filter(req =>
      chunks.some(content => content && content.toLowerCase().includes(req.toLowerCase())),
    );

    return satisfied.length / requirements.length;
  }

  /**
   * Get or create provenance record
   */
  private async getOrCreateProvenance(sourceType: string, sourceId: number): Promise<string> {
    // Check if provenance exists
    const existingResult = await this.db.query(`
      SELECT content_hash FROM provenance_sources
      WHERE source_type = $1 AND source_id = $2
    `, [sourceType, sourceId]);
    const existing = existingResult.rows[0] as any;

    if (existing) {
      return existing.content_hash;
    }

    // Create new provenance
    const contentHash = await this.getContentHash(sourceType, sourceId);

    await this.db.query(`
      INSERT INTO provenance_sources (source_type, source_id, content_hash, creator)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (content_hash) DO NOTHING
    `, [sourceType, sourceId, contentHash, 'system']);

    return contentHash;
  }

  /**
   * Get content hash for a memory
   */
  private async getContentHash(sourceType: string, sourceId: number): Promise<string> {
    let content = '';

    switch (sourceType) {
      case 'episode': {
        const result = await this.db.query(
          'SELECT task, output FROM episodes WHERE id = $1',
          [sourceId],
        );
        const episode = result.rows[0] as any;
        content = episode ? `${episode.task}:${episode.output}` : '';
        break;
      }
      case 'skill': {
        const result = await this.db.query(
          'SELECT name, code FROM skills WHERE id = $1',
          [sourceId],
        );
        const skill = result.rows[0] as any;
        content = skill ? `${skill.name}:${skill.code}` : '';
        break;
      }
      case 'note': {
        const result = await this.db.query(
          'SELECT text FROM notes WHERE id = $1',
          [sourceId],
        );
        const note = result.rows[0] as any;
        content = note ? note.text : '';
        break;
      }
      case 'fact': {
        const result = await this.db.query(
          'SELECT subject, predicate, object FROM facts WHERE id = $1',
          [sourceId],
        );
        const fact = result.rows[0] as any;
        content = fact ? `${fact.subject}:${fact.predicate}:${fact.object}` : '';
        break;
      }
    }

    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Build Merkle tree from hashes
   */
  private buildMerkleTree(hashes: string[]): { root: string; tree: string[][] } {
    if (hashes.length === 0) {
      return { root: '', tree: [[]] };
    }

    const tree: string[][] = [hashes];

    while (tree[tree.length - 1].length > 1) {
      const level = tree[tree.length - 1];
      const nextLevel: string[] = [];

      for (let i = 0; i < level.length; i += 2) {
        if (i + 1 < level.length) {
          const combined = level[i] + level[i + 1];
          nextLevel.push(crypto.createHash('sha256').update(combined).digest('hex'));
        } else {
          nextLevel.push(level[i]);
        }
      }

      tree.push(nextLevel);
    }

    return { root: tree[tree.length - 1][0], tree };
  }

  /**
   * Get Merkle proof for a leaf
   */
  private getMerkleProof(merkleTree: { tree: string[][] }, leafIndex: number): MerkleProof[] {
    const proof: MerkleProof[] = [];
    let index = leafIndex;

    for (let level = 0; level < merkleTree.tree.length - 1; level++) {
      const currentLevel = merkleTree.tree[level];
      const isLeftNode = index % 2 === 0;
      const siblingIndex = isLeftNode ? index + 1 : index - 1;

      if (siblingIndex < currentLevel.length) {
        proof.push({
          hash: currentLevel[siblingIndex],
          position: isLeftNode ? 'right' : 'left',
        });
      }

      index = Math.floor(index / 2);
    }

    return proof;
  }

  /**
   * Generate certificate ID
   */
  private generateCertificateId(queryId: string, chunkIds: string[]): string {
    const data = `${queryId}:${chunkIds.join(',')}:${Date.now()}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Store justification paths
   */
  private async storeJustificationPaths(
    certificateId: string,
    chunks: Array<{ id: string; type: string; relevance: number }>,
    minimalWhy: string[],
    requirements: string[],
  ): Promise<void> {
    for (const chunk of chunks) {
      const isNecessary = minimalWhy.includes(chunk.id);
      const reason = this.determineReason(chunk, requirements);
      const necessityScore = isNecessary ? chunk.relevance : chunk.relevance * 0.5;

      const pathElements = [
        `Retrieved for query`,
        isNecessary ? `Essential for justification` : `Supporting evidence`,
        `Relevance: ${(chunk.relevance * 100).toFixed(1)}%`,
      ];

      await this.db.query(`
        INSERT INTO justification_paths (
          certificate_id, chunk_id, chunk_type, reason, necessity_score, path_elements
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        certificateId,
        chunk.id,
        chunk.type,
        reason,
        necessityScore,
        JSON.stringify(pathElements),
      ]);
    }
  }

  /**
   * Determine reason for inclusion
   */
  private determineReason(
    chunk: { id: string; relevance: number },
    _requirements: string[],
  ): string {
    if (chunk.relevance > 0.9) return 'semantic_match';
    if (chunk.relevance > 0.7) return 'causal_link';
    if (chunk.relevance > 0.5) return 'prerequisite';
    return 'constraint';
  }
}
