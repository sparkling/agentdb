// charter: dispatch
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
 */

import type { VectorBackend } from '../backends/VectorBackend.js';
import { HierarchicalMemory, type MemoryItem, type MemoryTier } from './HierarchicalMemory.js';
import { EmbeddingService } from './EmbeddingService.js';
import { cosineSimilarity } from '../utils/similarity.js';
import type { MutationContext } from '../archivist/mutation-context.js';

// Database type from db-fallback
type Database = any;

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

export class MemoryConsolidation {
  private db: Database;
  private hierarchicalMemory: HierarchicalMemory;
  private embedder: EmbeddingService;
  private vectorBackend?: VectorBackend;
  private config: ConsolidationConfig;

  // Spaced repetition tracking
  private repetitionSchedules = new Map<string, RepetitionSchedule>();

  constructor(
    db: Database,
    hierarchicalMemory: HierarchicalMemory,
    embedder: EmbeddingService,
    vectorBackend?: VectorBackend,
    config?: Partial<ConsolidationConfig>
  ) {
    this.db = db;
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

    this.initializeDatabase();
    this.loadRepetitionSchedules();
  }

  /**
   * Initialize database tables for consolidation tracking
   */
  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS consolidation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        execution_time_ms INTEGER NOT NULL,
        episodic_processed INTEGER NOT NULL,
        semantic_created INTEGER NOT NULL,
        memories_forgotten INTEGER NOT NULL,
        clusters_formed INTEGER NOT NULL,
        retention_rate REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS spaced_repetition (
        memory_id TEXT PRIMARY KEY,
        next_review INTEGER NOT NULL,
        interval INTEGER NOT NULL,
        ease_factor REAL NOT NULL,
        repetitions INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_spaced_next_review ON spaced_repetition(next_review);
    `);
  }

  /**
   * Run nightly consolidation process.
   *
   * ADR-0180 §Re-entrancy: each cluster's store→markConsolidated cascade runs
   * under its own `ctx.child('cluster')` (then `store` + `markConsolidated`
   * descents inside `createSemanticMemory`), and the post-cluster forgetting
   * sweep runs under `ctx.child('forget')` (with a `vectorRemove` leaf per
   * forgotten memory). Per ADR-0180 Phase 9 Scenario C the resulting tree
   * depth must remain ≤ 3.
   *
   * Bodies inside each `ctx.child(...)` block intentionally retain the legacy
   * direct-DB call path — substrate-seam wire-up lands in F4-2 (handler
   * registration). The children are minted to seed the audit tree.
   */
  async consolidate(ctx?: MutationContext): Promise<ConsolidationReport> {
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

      // Step 3: Extract semantic patterns and create semantic memories —
      // each cluster gets its own `cluster` child (store + markConsolidated
      // descents nest inside `createSemanticMemory`).
      // Per-cluster failures are caught locally and noted; orchestration-level
      // fatals (DB lock, embedder crash) propagate to the outer try/catch and
      // re-throw. (ADR-0219 F-04-003)
      console.log('🧠 Extracting semantic patterns...');
      for (const cluster of clusters) {
        if (cluster.members.length >= this.config.minClusterSize) {
          const clusterCtx = ctx?.child('cluster');
          try {
            const semanticMemory = await this.createSemanticMemory(cluster, clusterCtx);
            if (semanticMemory) {
              report.semanticCreated++;
            }
          } catch (clusterError) {
            // Per-cluster error: log and continue with remaining clusters.
            console.error(`❌ Failed to create semantic memory for cluster ${cluster.id}:`, clusterError);
            report.recommendations.push(
              `Cluster ${cluster.id} failed: ${(clusterError as Error).message}`
            );
          }
        }
      }
      console.log(`   Created ${report.semanticCreated} semantic memories`);

      // Step 4: Apply forgetting curve — `forget` child wraps the DELETE +
      // vector-backend.remove sweep (a `vectorRemove` leaf is minted per
      // forgotten memory inside).
      console.log('🗑️  Applying forgetting curve...');
      const forgetCtx = ctx?.child('forget');
      const forgotten = await this.applyForgettingCurve(candidates, forgetCtx);
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

      // Step 7: Generate recommendations; merge with any per-cluster error
      // messages that were accumulated earlier in the loop.
      const clusterErrors = report.recommendations; // saved from the loop
      report.recommendations = [...this.generateRecommendations(report), ...clusterErrors];

      report.executionTimeMs = Date.now() - startTime;

      // Log consolidation
      this.logConsolidation(report);

      console.log('\n✅ Memory Consolidation Complete');
      console.log(`   Time: ${report.executionTimeMs}ms`);
      console.log(`   Retention: ${(report.retentionRate * 100).toFixed(1)}%`);

      return report;
    } catch (error) {
      // Fatal at the orchestration level (DB lock, embedder crash, etc.) —
      // re-throw so the caller sees Promise.reject, not a partial report.
      // (ADR-0219 F-04-003 — fail-loud on orchestration fatals)
      console.error('❌ Memory consolidation failed:', error);
      throw error;
    }
  }

  /**
   * Get episodic memories that are candidates for consolidation
   */
  private async getConsolidationCandidates(): Promise<MemoryItem[]> {
    const rows = this.db.prepare(`
      SELECT * FROM hierarchical_memory
      WHERE tier = 'episodic'
        AND importance >= ?
        AND access_count >= ?
      ORDER BY importance DESC, access_count DESC
    `).all(this.config.importanceThreshold, this.config.minAccessCount);

    const candidates: MemoryItem[] = [];

    for (const row of rows) {
      const embedding = await this.embedder.embed(row.content);
      candidates.push({
        id: row.id,
        tier: row.tier as MemoryTier,
        content: row.content,
        embedding,
        importance: row.importance,
        accessCount: row.access_count,
        createdAt: row.created_at,
        lastAccessedAt: row.last_accessed_at,
        lastRehearsedAt: row.last_rehearsed_at,
        consolidatedAt: row.consolidated_at,
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
   * Create semantic memory from cluster.
   *
   * ADR-0180 §Re-entrancy: the per-cluster cascade is the semantic `store`
   * followed by one `markConsolidated` leaf per source member. Both legs are
   * minted as children of the caller's `cluster` context so the audit tree
   * reconstructs as cluster → (store, markConsolidated*).
   */
  private async createSemanticMemory(
    cluster: MemoryCluster,
    ctx?: MutationContext,
  ): Promise<string | null> {
    // Extract common pattern from cluster members
    const pattern = this.extractSemanticPattern(cluster);
    if (!pattern) return null;

    // Calculate consolidated importance (weighted by access count).
    // Guard against totalAccess === 0 to avoid NaN propagation (ADR-0219 F-04-002):
    // fall back to the simple mean already computed during clustering.
    const totalAccess = cluster.members.reduce((sum, m) => sum + m.accessCount, 0);
    const weightedImportance = totalAccess === 0
      ? cluster.avgImportance
      : cluster.members.reduce(
          (sum, m) => sum + (m.importance * m.accessCount),
          0
        ) / totalAccess;

    // Store as semantic memory — `store` child wraps the hierarchical-memory write.
    const storeCtx = ctx?.child('store');
    void storeCtx;
    const memoryId = await (this.hierarchicalMemory as any).store(
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

    // Mark source episodic memories as consolidated — one `markConsolidated`
    // child per member so each UPDATE is its own audit leaf.
    for (const member of cluster.members) {
      const markCtx = ctx?.child('markConsolidated');
      await this.markConsolidated(member.id, markCtx);
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
    const contents = cluster.members.map(m => m.content);

    // For now, just return a summary of the most important memory
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
   * Mark episodic memory as consolidated.
   *
   * ADR-0180: `ctx` is the `markConsolidated` child minted by
   * `createSemanticMemory`. Body still issues the legacy direct UPDATE —
   * substrate-seam wire-up lands in F4-2.
   */
  private async markConsolidated(memoryId: string, ctx?: MutationContext): Promise<void> {
    void ctx;
    const now = Date.now();
    this.db.prepare(`
      UPDATE hierarchical_memory
      SET consolidated_at = ?
      WHERE id = ?
    `).run(now, memoryId);
  }

  /**
   * Apply forgetting curve and delete low-value memories.
   *
   * ADR-0180: `ctx` is the `forget` child minted by `consolidate()`. Each
   * forgotten memory's vector-backend.remove runs under its own
   * `vectorRemove` leaf so the audit tree captures one entry per dropped
   * vector. Legacy direct-DB DELETE path retained (F4-2 substrate-seam).
   */
  private async applyForgettingCurve(
    memories: MemoryItem[],
    ctx?: MutationContext,
  ): Promise<number> {
    let forgotten = 0;

    for (const memory of memories) {
      const retention = this.calculateRetention(memory);

      if (retention < this.config.forgettingThreshold) {
        // Delete from database
        this.db.prepare('DELETE FROM hierarchical_memory WHERE id = ?').run(memory.id);

        // Remove from vector backend — `vectorRemove` leaf per drop.
        if (this.vectorBackend) {
          const vectorCtx = ctx?.child('vectorRemove');
          void vectorCtx;
          this.vectorBackend.remove(memory.id);
        }

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
          this.updateRepetitionSchedule(memory.id, true);
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
        this.saveRepetitionSchedule(schedule);
      }
    }
  }

  /**
   * Update repetition schedule after review
   */
  private updateRepetitionSchedule(memoryId: string, success: boolean): void {
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

    this.saveRepetitionSchedule(schedule);
  }

  /**
   * Save repetition schedule to database
   */
  private saveRepetitionSchedule(schedule: RepetitionSchedule): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO spaced_repetition
      (memory_id, next_review, interval, ease_factor, repetitions)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      schedule.memoryId,
      schedule.nextReview,
      schedule.interval,
      schedule.easeFactor,
      schedule.repetitions
    );
  }

  /**
   * Load repetition schedules from database
   */
  private loadRepetitionSchedules(): void {
    const rows = this.db.prepare('SELECT * FROM spaced_repetition').all();

    for (const row of rows) {
      this.repetitionSchedules.set(row.memory_id, {
        memoryId: row.memory_id,
        nextReview: row.next_review,
        interval: row.interval,
        easeFactor: row.ease_factor,
        repetitions: row.repetitions,
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
  private logConsolidation(report: ConsolidationReport): void {
    this.db.prepare(`
      INSERT INTO consolidation_log (
        timestamp, execution_time_ms, episodic_processed, semantic_created,
        memories_forgotten, clusters_formed, retention_rate
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      report.timestamp,
      report.executionTimeMs,
      report.episodicProcessed,
      report.semanticCreated,
      report.memoriesForgotten,
      report.clustersFormed,
      report.retentionRate
    );
  }

  /**
   * Get consolidation history
   */
  async getConsolidationHistory(limit: number = 10): Promise<ConsolidationReport[]> {
    const rows = this.db.prepare(`
      SELECT * FROM consolidation_log
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit);

    return rows.map(row => ({
      timestamp: row.timestamp,
      executionTimeMs: row.execution_time_ms,
      episodicProcessed: row.episodic_processed,
      semanticCreated: row.semantic_created,
      memoriesForgotten: row.memories_forgotten,
      clustersFormed: row.clusters_formed,
      avgImportance: 0,
      retentionRate: row.retention_rate,
      recommendations: [],
    }));
  }
}
