/**
 * MemoryConsolidation - Nightly Memory Processing
 *
 * Implements automatic memory consolidation from episodic to semantic memory
 * using spaced repetition and importance scoring.
 *
 * Based on:
 * - Complementary Learning Systems (McClelland et al., 1995)
 * - Active Systems Consolidation (Diekelmann & Born, 2010)
 * - Spaced Repetition (Ebbinghaus, 1885)
 *
 * Process:
 * 1. Identify consolidation candidates (high importance + multiple accesses)
 * 2. Cluster similar episodic memories
 * 3. Extract semantic patterns (abstractions)
 * 4. Promote to semantic memory
 * 5. Apply forgetting to low-value episodic memories
 * 6. Schedule spaced repetition for important memories
 *
 * ADR-066 Phase P2-3
 *
 * ADR-0170 Phase B.10 (2026-05-11): ported from SQLite (better-sqlite3) to
 * PostgreSQL via PostgresBackend. The sqlite code path was dead-stripped
 * atomically with this commit. Reads HierarchicalMemory's
 * `hierarchical_memory` table (ported in Wave 1a / B.1). Public methods
 * are async because pglite is Promise-based.
 */

import type { PostgresBackend } from '../backends/postgres/PostgresBackend.js';
import type { VectorBackend } from '../backends/VectorBackend.js';
import { HierarchicalMemory, type MemoryItem, type MemoryTier } from './HierarchicalMemory.js';
import { EmbeddingService } from './EmbeddingService.js';
import { cosineSimilarity } from '../utils/vector-math.js';

/** Consolidation result report */
export interface ConsolidationReport {
  timestamp: number;
  executionTimeMs: number;
  episodicProcessed: number;
  semanticCreated: number;
  memoriesForgotten: number;
  clustersFormed: number;
  avgImportance: number;
  retentionRate: number;
  recommendations: string[];
}

/** Memory cluster for consolidation */
interface MemoryCluster {
  id: string;
  centroid: Float32Array;
  members: MemoryItem[];
  avgImportance: number;
  semanticPattern?: string;
}

/** Spaced repetition schedule */
interface RepetitionSchedule {
  memoryId: string;
  nextReview: number;
  interval: number;
  easeFactor: number;
  repetitions: number;
}

export interface ConsolidationConfig {
  /** Minimum similarity for clustering (0-1) */
  clusterThreshold: number;
  /** Minimum cluster size for semantic extraction */
  minClusterSize: number;
  /** Maximum cluster size before splitting */
  maxClusterSize: number;
  /** Importance threshold for consolidation */
  importanceThreshold: number;
  /** Minimum access count for consolidation */
  minAccessCount: number;
  /** Enable spaced repetition */
  enableSpacedRepetition: boolean;
  /** Initial repetition interval (ms) */
  initialInterval: number;
  /** Interval multiplier for successful recall */
  intervalMultiplier: number;
  /** Forgetting threshold (retention below this = forget) */
  forgettingThreshold: number;
}

/**
 * Row shape returned by postgres SELECTs against `hierarchical_memory`.
 * Mirrors HierarchicalMemory's private interface — duplicated here to keep
 * the row hydration local to this controller.
 */
interface HierarchicalMemoryRow {
  id: string;
  tier: MemoryTier;
  content: string;
  importance: number;
  access_count: number;
  created_at: number;
  last_accessed_at: number;
  last_rehearsed_at: number | null;
  consolidated_at: number | null;
  tags: string | null;
  context: string | null;
  metadata: string | null;
}

interface SpacedRepetitionRow {
  memory_id: string;
  next_review: number;
  interval: number;
  ease_factor: number;
  repetitions: number;
}

interface ConsolidationLogRow {
  timestamp: number;
  execution_time_ms: number;
  episodic_processed: number;
  semantic_created: number;
  memories_forgotten: number;
  clusters_formed: number;
  retention_rate: number;
}

export class MemoryConsolidation {
  private backend: PostgresBackend;
  private hierarchicalMemory: HierarchicalMemory;
  private embedder: EmbeddingService;
  private vectorBackend?: VectorBackend;
  private config: ConsolidationConfig;
  private schemaReady: Promise<void>;

  // Spaced repetition tracking
  private repetitionSchedules = new Map<string, RepetitionSchedule>();

  constructor(
    backend: PostgresBackend,
    hierarchicalMemory: HierarchicalMemory,
    embedder: EmbeddingService,
    vectorBackend?: VectorBackend,
    config?: Partial<ConsolidationConfig>
  ) {
    this.backend = backend;
    this.hierarchicalMemory = hierarchicalMemory;
    this.embedder = embedder;
    this.vectorBackend = vectorBackend;

    this.config = {
      clusterThreshold: 0.75,
      minClusterSize: 3,
      maxClusterSize: 20,
      importanceThreshold: 0.6,
      minAccessCount: 3,
      enableSpacedRepetition: true,
      initialInterval: 24 * 60 * 60 * 1000, // 24 hours
      intervalMultiplier: 2.0,
      forgettingThreshold: 0.2,
      ...config,
    };

    this.schemaReady = this.initializeDatabase();
  }

  /**
   * Initialize database tables for consolidation tracking and hydrate the
   * in-memory spaced-repetition schedule cache.
   *
   * `backend.initialize()` is idempotent — the first controller to touch
   * the shared PostgresBackend pays the cluster-warm-up cost; subsequent
   * controllers no-op. The returned promise is awaited by every public
   * method before issuing its own SQL, so callers don't have to gate on a
   * separate ready() promise.
   */
  private async initializeDatabase(): Promise<void> {
    await this.backend.initialize();
    await this.backend.exec(`
      CREATE TABLE IF NOT EXISTS consolidation_log (
        id BIGSERIAL PRIMARY KEY,
        timestamp BIGINT NOT NULL,
        execution_time_ms BIGINT NOT NULL,
        episodic_processed BIGINT NOT NULL,
        semantic_created BIGINT NOT NULL,
        memories_forgotten BIGINT NOT NULL,
        clusters_formed BIGINT NOT NULL,
        retention_rate REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS spaced_repetition (
        memory_id TEXT PRIMARY KEY,
        next_review BIGINT NOT NULL,
        interval BIGINT NOT NULL,
        ease_factor REAL NOT NULL,
        repetitions BIGINT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_spaced_next_review ON spaced_repetition(next_review);
    `);

    await this.loadRepetitionSchedules();
  }

  /**
   * Run nightly consolidation process
   */
  async consolidate(): Promise<ConsolidationReport> {
    await this.schemaReady;

    console.log('\n🌙 Starting Memory Consolidation...\n');
    const startTime = Date.now();

    const report: ConsolidationReport = {
      timestamp: startTime,
      executionTimeMs: 0,
      episodicProcessed: 0,
      semanticCreated: 0,
      memoriesForgotten: 0,
      clustersFormed: 0,
      avgImportance: 0,
      retentionRate: 0,
      recommendations: [],
    };

    try {
      // Step 1: Get consolidation candidates
      console.log('📊 Identifying consolidation candidates...');
      const candidates = await this.getConsolidationCandidates();
      report.episodicProcessed = candidates.length;
      console.log(`   Found ${candidates.length} episodic memories`);

      if (candidates.length === 0) {
        console.log('✅ No memories to consolidate');
        report.executionTimeMs = Date.now() - startTime;
        return report;
      }

      // Step 2: Cluster similar memories
      console.log('🔗 Clustering similar memories...');
      const clusters = await this.clusterMemories(candidates);
      report.clustersFormed = clusters.length;
      console.log(`   Formed ${clusters.length} clusters`);

      // Step 3: Extract semantic patterns and create semantic memories
      console.log('🧠 Extracting semantic patterns...');
      for (const cluster of clusters) {
        if (cluster.members.length >= this.config.minClusterSize) {
          const semanticMemory = await this.createSemanticMemory(cluster);
          if (semanticMemory) {
            report.semanticCreated++;
          }
        }
      }
      console.log(`   Created ${report.semanticCreated} semantic memories`);

      // Step 4: Apply forgetting curve
      console.log('🗑️  Applying forgetting curve...');
      const forgotten = await this.applyForgettingCurve(candidates);
      report.memoriesForgotten = forgotten;
      console.log(`   Forgot ${forgotten} low-value memories`);

      // Step 5: Schedule spaced repetition
      if (this.config.enableSpacedRepetition) {
        console.log('📅 Scheduling spaced repetition...');
        await this.scheduleSpacedRepetition(candidates);
        console.log(`   Scheduled ${candidates.length - forgotten} memories`);
      }

      // Step 6: Calculate statistics
      const totalImportance = candidates.reduce((sum, m) => sum + m.importance, 0);
      report.avgImportance = candidates.length > 0 ? totalImportance / candidates.length : 0;
      report.retentionRate = candidates.length > 0
        ? (candidates.length - forgotten) / candidates.length
        : 0;

      // Step 7: Generate recommendations
      report.recommendations = this.generateRecommendations(report);

      report.executionTimeMs = Date.now() - startTime;

      // Log consolidation
      await this.logConsolidation(report);

      console.log('\n✅ Memory Consolidation Complete');
      console.log(`   Time: ${report.executionTimeMs}ms`);
      console.log(`   Retention: ${(report.retentionRate * 100).toFixed(1)}%`);

      return report;
    } catch (error) {
      console.error('❌ Memory consolidation failed:', error);
      report.executionTimeMs = Date.now() - startTime;
      return report;
    }
  }

  /**
   * Get episodic memories that are candidates for consolidation
   */
  private async getConsolidationCandidates(): Promise<MemoryItem[]> {
    await this.schemaReady;

    const res = await this.backend.query(
      `SELECT * FROM hierarchical_memory
       WHERE tier = 'episodic'
         AND importance >= $1
         AND access_count >= $2
       ORDER BY importance DESC, access_count DESC`,
      [this.config.importanceThreshold, this.config.minAccessCount],
    );
    const rows = res.rows as HierarchicalMemoryRow[];

    const candidates: MemoryItem[] = [];

    for (const row of rows) {
      const embedding = await this.embedder.embed(row.content);
      candidates.push({
        id: row.id,
        tier: row.tier,
        content: row.content,
        embedding,
        importance: Number(row.importance),
        accessCount: Number(row.access_count),
        createdAt: Number(row.created_at),
        lastAccessedAt: Number(row.last_accessed_at),
        lastRehearsedAt: row.last_rehearsed_at != null ? Number(row.last_rehearsed_at) : undefined,
        consolidatedAt: row.consolidated_at != null ? Number(row.consolidated_at) : undefined,
        tags: row.tags ? JSON.parse(row.tags) : undefined,
        context: row.context ? JSON.parse(row.context) : undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      });
    }

    return candidates;
  }

  /**
   * Cluster similar memories using hierarchical clustering
   */
  private async clusterMemories(memories: MemoryItem[]): Promise<MemoryCluster[]> {
    if (memories.length === 0) return [];

    const clusters: MemoryCluster[] = [];
    const assigned = new Set<string>();

    // Simple greedy clustering
    for (const memory of memories) {
      if (assigned.has(memory.id)) continue;

      // Create new cluster
      const cluster: MemoryCluster = {
        id: `cluster-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        centroid: memory.embedding!,
        members: [memory],
        avgImportance: memory.importance,
      };

      assigned.add(memory.id);

      // Find similar memories to add to cluster
      for (const candidate of memories) {
        if (assigned.has(candidate.id)) continue;
        if (cluster.members.length >= this.config.maxClusterSize) break;

        const similarity = cosineSimilarity(cluster.centroid, candidate.embedding!);

        if (similarity >= this.config.clusterThreshold) {
          cluster.members.push(candidate);
          assigned.add(candidate.id);

          // Update centroid (simple average)
          this.updateCentroid(cluster);
        }
      }

      // Calculate average importance
      cluster.avgImportance = cluster.members.reduce((sum, m) => sum + m.importance, 0) / cluster.members.length;

      clusters.push(cluster);
    }

    return clusters;
  }

  /**
   * Update cluster centroid (simple average)
   */
  private updateCentroid(cluster: MemoryCluster): void {
    const dimension = cluster.centroid.length;
    const newCentroid = new Float32Array(dimension);

    for (const member of cluster.members) {
      for (let i = 0; i < dimension; i++) {
        newCentroid[i] += member.embedding![i];
      }
    }

    for (let i = 0; i < dimension; i++) {
      newCentroid[i] /= cluster.members.length;
    }

    cluster.centroid = newCentroid;
  }

  /**
   * Create semantic memory from cluster
   */
  private async createSemanticMemory(cluster: MemoryCluster): Promise<string | null> {
    // Extract common pattern from cluster members
    const pattern = this.extractSemanticPattern(cluster);
    if (!pattern) return null;

    // Calculate consolidated importance (weighted by access count)
    const totalAccess = cluster.members.reduce((sum, m) => sum + m.accessCount, 0);
    const weightedImportance = totalAccess > 0
      ? cluster.members.reduce(
          (sum, m) => sum + (m.importance * m.accessCount),
          0,
        ) / totalAccess
      : cluster.avgImportance;

    // Store as semantic memory
    const memoryId = await this.hierarchicalMemory.store(
      pattern,
      weightedImportance,
      'semantic',
      {
        tags: this.extractCommonTags(cluster),
        metadata: {
          clusterId: cluster.id,
          clusterSize: cluster.members.length,
          sourceMemories: cluster.members.map(m => m.id),
          consolidatedAt: Date.now(),
        },
      }
    );

    // Mark source episodic memories as consolidated
    for (const member of cluster.members) {
      await this.markConsolidated(member.id);
    }

    return memoryId;
  }

  /**
   * Extract semantic pattern from cluster
   */
  private extractSemanticPattern(cluster: MemoryCluster): string | null {
    if (cluster.members.length < this.config.minClusterSize) return null;

    // Simple pattern: find common themes in content
    // In production, this could use LLM for better abstraction
    const mostImportant = cluster.members.reduce(
      (best, m) => m.importance > best.importance ? m : best
    );

    const pattern = `Pattern: ${mostImportant.content} (consolidated from ${cluster.members.length} similar memories)`;

    return pattern;
  }

  /**
   * Extract common tags from cluster members
   */
  private extractCommonTags(cluster: MemoryCluster): string[] {
    const tagCounts = new Map<string, number>();

    for (const member of cluster.members) {
      if (member.tags) {
        for (const tag of member.tags) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
    }

    // Return tags that appear in at least 50% of members
    const threshold = cluster.members.length * 0.5;
    return Array.from(tagCounts.entries())
      .filter(([_, count]) => count >= threshold)
      .map(([tag, _]) => tag);
  }

  /**
   * Mark episodic memory as consolidated
   */
  private async markConsolidated(memoryId: string): Promise<void> {
    await this.schemaReady;

    const now = Date.now();
    await this.backend.query(
      `UPDATE hierarchical_memory
       SET consolidated_at = $1
       WHERE id = $2`,
      [now, memoryId],
    );
  }

  /**
   * Apply forgetting curve and delete low-value memories
   */
  private async applyForgettingCurve(memories: MemoryItem[]): Promise<number> {
    await this.schemaReady;

    let forgotten = 0;

    for (const memory of memories) {
      const retention = this.calculateRetention(memory);

      if (retention < this.config.forgettingThreshold) {
        // ADR-0170 Phase C.1: DELETE removes the row + pgvector index
        // entry atomically. No separate vectorBackend cleanup.
        await this.backend.query(
          `DELETE FROM hierarchical_memory WHERE id = $1`,
          [memory.id],
        );

        forgotten++;
      }
    }

    return forgotten;
  }

  /**
   * Calculate retention using Ebbinghaus forgetting curve
   */
  private calculateRetention(memory: MemoryItem): number {
    const now = Date.now();
    const daysSinceCreation = (now - memory.createdAt) / (24 * 60 * 60 * 1000);
    const daysSinceRehearsal = memory.lastRehearsedAt
      ? (now - memory.lastRehearsedAt) / (24 * 60 * 60 * 1000)
      : daysSinceCreation;

    // Strength increases with importance and rehearsal
    const baseStrength = 5; // days
    const importanceMultiplier = 1 + memory.importance * 2;
    const rehearsalBoost = memory.lastRehearsedAt ? 1.5 : 1.0;

    const strength = baseStrength * importanceMultiplier * rehearsalBoost;

    // Ebbinghaus: R = e^(-t/S)
    return Math.exp(-daysSinceRehearsal / strength);
  }

  /**
   * Schedule spaced repetition for memories
   */
  private async scheduleSpacedRepetition(memories: MemoryItem[]): Promise<void> {
    const now = Date.now();

    for (const memory of memories) {
      const existingSchedule = this.repetitionSchedules.get(memory.id);

      if (existingSchedule) {
        // Update existing schedule if review is due
        if (now >= existingSchedule.nextReview) {
          await this.updateRepetitionSchedule(memory.id, true);
        }
      } else {
        // Create new schedule
        const schedule: RepetitionSchedule = {
          memoryId: memory.id,
          nextReview: now + this.config.initialInterval,
          interval: this.config.initialInterval,
          easeFactor: 2.5, // SM-2 algorithm default
          repetitions: 0,
        };

        this.repetitionSchedules.set(memory.id, schedule);
        await this.saveRepetitionSchedule(schedule);
      }
    }
  }

  /**
   * Update repetition schedule after review
   */
  private async updateRepetitionSchedule(memoryId: string, success: boolean): Promise<void> {
    const schedule = this.repetitionSchedules.get(memoryId);
    if (!schedule) return;

    if (success) {
      // Increase interval (spaced repetition)
      schedule.repetitions++;
      schedule.interval = Math.floor(schedule.interval * this.config.intervalMultiplier);
      schedule.nextReview = Date.now() + schedule.interval;
    } else {
      // Reset interval on failure
      schedule.repetitions = 0;
      schedule.interval = this.config.initialInterval;
      schedule.nextReview = Date.now() + schedule.interval;
    }

    await this.saveRepetitionSchedule(schedule);
  }

  /**
   * Save repetition schedule to database
   */
  private async saveRepetitionSchedule(schedule: RepetitionSchedule): Promise<void> {
    await this.schemaReady;

    await this.backend.query(
      `INSERT INTO spaced_repetition
       (memory_id, next_review, interval, ease_factor, repetitions)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (memory_id) DO UPDATE SET
         next_review = EXCLUDED.next_review,
         interval = EXCLUDED.interval,
         ease_factor = EXCLUDED.ease_factor,
         repetitions = EXCLUDED.repetitions`,
      [
        schedule.memoryId,
        schedule.nextReview,
        schedule.interval,
        schedule.easeFactor,
        schedule.repetitions,
      ],
    );
  }

  /**
   * Load repetition schedules from database
   */
  private async loadRepetitionSchedules(): Promise<void> {
    const res = await this.backend.query(`SELECT * FROM spaced_repetition`);
    const rows = res.rows as SpacedRepetitionRow[];

    for (const row of rows) {
      this.repetitionSchedules.set(row.memory_id, {
        memoryId: row.memory_id,
        nextReview: Number(row.next_review),
        interval: Number(row.interval),
        easeFactor: Number(row.ease_factor),
        repetitions: Number(row.repetitions),
      });
    }
  }

  /**
   * Generate recommendations based on consolidation report
   */
  private generateRecommendations(report: ConsolidationReport): string[] {
    const recommendations: string[] = [];

    if (report.retentionRate < 0.5) {
      recommendations.push('Low retention rate. Consider increasing importance thresholds.');
    }

    if (report.clustersFormed === 0 && report.episodicProcessed > 10) {
      recommendations.push('No clusters formed. Consider lowering similarity threshold.');
    }

    if (report.semanticCreated < report.clustersFormed * 0.5) {
      recommendations.push('Low semantic memory creation. Check cluster size thresholds.');
    }

    if (report.avgImportance < 0.5) {
      recommendations.push('Average importance is low. Consider adjusting importance scoring.');
    }

    if (report.memoriesForgotten > report.episodicProcessed * 0.8) {
      recommendations.push('High forgetting rate. Consider lowering forgetting threshold.');
    }

    return recommendations;
  }

  /**
   * Log consolidation to database
   */
  private async logConsolidation(report: ConsolidationReport): Promise<void> {
    await this.schemaReady;

    await this.backend.query(
      `INSERT INTO consolidation_log (
         timestamp, execution_time_ms, episodic_processed, semantic_created,
         memories_forgotten, clusters_formed, retention_rate
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        report.timestamp,
        report.executionTimeMs,
        report.episodicProcessed,
        report.semanticCreated,
        report.memoriesForgotten,
        report.clustersFormed,
        report.retentionRate,
      ],
    );
  }

  /**
   * Get consolidation history
   */
  async getConsolidationHistory(limit: number = 10): Promise<ConsolidationReport[]> {
    await this.schemaReady;

    const res = await this.backend.query(
      `SELECT * FROM consolidation_log
       ORDER BY timestamp DESC
       LIMIT $1`,
      [limit],
    );
    const rows = res.rows as ConsolidationLogRow[];

    return rows.map(row => ({
      timestamp: Number(row.timestamp),
      executionTimeMs: Number(row.execution_time_ms),
      episodicProcessed: Number(row.episodic_processed),
      semanticCreated: Number(row.semantic_created),
      memoriesForgotten: Number(row.memories_forgotten),
      clustersFormed: Number(row.clusters_formed),
      avgImportance: 0,
      retentionRate: Number(row.retention_rate),
      recommendations: [],
    }));
  }
}
