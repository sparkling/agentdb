/**
 * Nightly Learner - Automated Causal Discovery and Consolidation
 *
 * Runs as a background job to:
 * 1. Discover new causal edges from episode patterns
 * 2. Run A/B experiments on promising hypotheses
 * 3. Calculate uplift for completed experiments
 * 4. Prune low-confidence edges
 * 5. Consolidate episodes into reusable skills via SkillLibrary
 * 6. Update rerank weights based on performance
 *
 * Based on doubly robust learner:
 * τ̂(x) = μ1(x) − μ0(x) + [a*(y−μ1(x)) / e(x)] − [(1−a)*(y−μ0(x)) / (1−e(x))]
 *
 * ADR-0170 Phase B.8: ported to PostgreSQL dialect (pglite embedded / `pg`
 * server) via PostgresBackend. SQLite path dead-stripped — the constructor
 * no longer runs the `PRAGMA table_info` migration block (that block existed
 * only to repair SQLite installations created from out-of-sync DDL prior to
 * frontier-schema.sql becoming canonical). Schema bootstrap is owned by
 * `core/AgentDB.ts` → `frontier-schema.sql` (Phase A.5). Public API moves
 * from sync `prepare()/run()` to async `query()/exec()` against the postgres
 * client.
 *
 * SQL dialect changes:
 *   - `?` placeholders → `$N` numbered
 *   - INTEGER PK AUTOINCREMENT bootstrap removed (canonical schema lives in
 *     frontier-schema.sql; defensive idempotent CREATE IF NOT EXISTS kept
 *     for unit tests that construct against a bare PostgresBackend)
 *   - DELETE ... RETURNING id used for change-count (postgres pattern)
 *   - GROUP BY + HAVING aggregate-pure (createExperiments candidates query)
 *   - Self-JOIN qualifications kept explicit (e1.col / e2.col) — postgres
 *     planner is stricter on ambiguous column refs
 */

import type { PostgresBackend } from '../backends/postgres/PostgresBackend.js';
import { CausalMemoryGraph, CausalEdge } from './CausalMemoryGraph.js';
import { ReflexionMemory } from './ReflexionMemory.js';
import { SkillLibrary } from './SkillLibrary.js';
import { EmbeddingService } from './EmbeddingService.js';
import { AttentionService, type FlashAttentionConfig } from '../utils/LegacyAttentionAdapter.js';
import { cosineSimilarity } from '../utils/vector-math.js';
import { getEmbeddingConfig } from '../config/embedding-config.js';

export interface LearnerConfig {
  minSimilarity: number;
  minSampleSize: number;
  confidenceThreshold: number;
  upliftThreshold: number;
  pruneOldEdges: boolean;
  edgeMaxAgeDays: number;
  autoExperiments: boolean;
  experimentBudget: number;
  ENABLE_FLASH_CONSOLIDATION?: boolean;
  flashConfig?: Partial<FlashAttentionConfig>;
}

export interface LearnerReport {
  timestamp: number;
  executionTimeMs: number;
  edgesDiscovered: number;
  edgesPruned: number;
  experimentsCompleted: number;
  experimentsCreated: number;
  avgUplift: number;
  avgConfidence: number;
  skillsCreated: number;
  skillsUpdated: number;
  patternsExtracted: number;
  recommendations: string[];
}

const toNum = (v: unknown): number => {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return Number(v);
};

export class NightlyLearner {
  private db: PostgresBackend;
  private causalGraph: CausalMemoryGraph;
  private reflexion: ReflexionMemory;
  private skillLibrary: SkillLibrary;
  private embedder: EmbeddingService;
  private attentionService?: AttentionService;
  private ready: Promise<void>;

  constructor(
    db: PostgresBackend,
    embedder: EmbeddingService,
    private config: LearnerConfig = {
      minSimilarity: 0.7,
      minSampleSize: 30,
      confidenceThreshold: 0.6,
      upliftThreshold: 0.05,
      pruneOldEdges: true,
      edgeMaxAgeDays: 90,
      autoExperiments: true,
      experimentBudget: 10,
      ENABLE_FLASH_CONSOLIDATION: false,
    },
    causalGraph?: CausalMemoryGraph,
    reflexion?: ReflexionMemory,
    skillLibrary?: SkillLibrary,
    attentionService?: AttentionService,
  ) {
    this.db = db;
    this.embedder = embedder;

    this.causalGraph = causalGraph || new CausalMemoryGraph(db as any);
    this.reflexion = reflexion || new ReflexionMemory(db as any, embedder);
    this.skillLibrary = skillLibrary || new SkillLibrary(db as any, embedder);

    if (attentionService) {
      this.attentionService = attentionService;
    } else if (this.config.ENABLE_FLASH_CONSOLIDATION) {
      this.attentionService = new AttentionService(db as any, {
        flash: {
          enabled: true,
          ...this.config.flashConfig,
        },
      });
    }

    this.ready = this.bootstrapSchema();
  }

  private async bootstrapSchema(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS causal_experiments (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        hypothesis TEXT,
        treatment_id BIGINT,
        treatment_type TEXT,
        control_id BIGINT,
        start_time BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        end_time BIGINT,
        sample_size BIGINT DEFAULT 0,
        treatment_mean REAL,
        control_mean REAL,
        uplift REAL,
        p_value REAL,
        confidence_interval_low REAL,
        confidence_interval_high REAL,
        status TEXT NOT NULL DEFAULT 'running',
        confidence REAL,
        metadata JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_causal_experiments_status ON causal_experiments(status);
      CREATE INDEX IF NOT EXISTS idx_causal_experiments_treatment ON causal_experiments(treatment_id);

      CREATE TABLE IF NOT EXISTS causal_observations (
        id BIGSERIAL PRIMARY KEY,
        experiment_id BIGINT NOT NULL,
        episode_id BIGINT,
        is_treatment BOOLEAN NOT NULL DEFAULT FALSE,
        outcome_value REAL NOT NULL,
        outcome_type TEXT,
        context TEXT,
        ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        FOREIGN KEY(experiment_id) REFERENCES causal_experiments(id)
      );
      CREATE INDEX IF NOT EXISTS idx_causal_observations_exp ON causal_observations(experiment_id);
    `);
  }

  async run(): Promise<LearnerReport> {
    await this.ready;
    console.log('\n🌙 Nightly Learner Starting...\n');
    const startTime = Date.now();

    const report: LearnerReport = {
      timestamp: startTime,
      executionTimeMs: 0,
      edgesDiscovered: 0,
      edgesPruned: 0,
      experimentsCompleted: 0,
      experimentsCreated: 0,
      avgUplift: 0,
      avgConfidence: 0,
      skillsCreated: 0,
      skillsUpdated: 0,
      patternsExtracted: 0,
      recommendations: []
    };

    try {
      console.log('📊 Discovering causal edges from episode patterns...');
      report.edgesDiscovered = await this.discoverCausalEdges();
      console.log(`   ✓ Discovered ${report.edgesDiscovered} new edges\n`);

      console.log('🧪 Completing A/B experiments...');
      report.experimentsCompleted = await this.completeExperiments();
      console.log(`   ✓ Completed ${report.experimentsCompleted} experiments\n`);

      if (this.config.autoExperiments) {
        console.log('🔬 Creating new A/B experiments...');
        report.experimentsCreated = await this.createExperiments();
        console.log(`   ✓ Created ${report.experimentsCreated} new experiments\n`);
      }

      if (this.config.pruneOldEdges) {
        console.log('🧹 Pruning low-confidence edges...');
        report.edgesPruned = await this.pruneEdges();
        console.log(`   ✓ Pruned ${report.edgesPruned} edges\n`);
      }

      try {
        const consolidation = await this.skillLibrary.consolidateEpisodesIntoSkills({
          minAttempts: 3,
          minReward: this.config.confidenceThreshold || 0.7,
          timeWindowDays: this.config.edgeMaxAgeDays || 30,
          extractPatterns: true,
        });
        report.skillsCreated = consolidation.created;
        report.skillsUpdated = consolidation.updated;
        report.patternsExtracted = consolidation.patterns?.length ?? 0;
      } catch (error) {
        // Non-fatal — skill consolidation is a bonus, not critical
      }

      const stats = await this.calculateStats();
      report.avgUplift = stats.avgUplift;
      report.avgConfidence = stats.avgConfidence;

      report.recommendations = this.generateRecommendations(report);

      report.executionTimeMs = Date.now() - startTime;

      console.log('✅ Nightly Learner Completed\n');
      this.printReport(report);

      return report;
    } catch (error) {
      console.error('❌ Nightly Learner Failed:', error);
      throw error;
    }
  }

  async discover(config: {
    minAttempts?: number;
    minSuccessRate?: number;
    minConfidence?: number;
    dryRun?: boolean;
  }): Promise<CausalEdge[]> {
    await this.ready;
    const edges: CausalEdge[] = [];
    await this.discoverCausalEdges();

    if (config.dryRun) {
      return edges;
    }

    return edges;
  }

  async consolidateEpisodes(sessionId?: string): Promise<{
    edgesDiscovered: number;
    episodesProcessed: number;
    metrics?: {
      computeTimeMs: number;
      peakMemoryMB: number;
      blocksProcessed: number;
    };
  }> {
    await this.ready;
    if (!this.attentionService) {
      const edgesDiscovered = await this.discoverCausalEdges();
      return { edgesDiscovered, episodesProcessed: 0 };
    }

    const episodes = sessionId
      ? (await this.db.query(
          `SELECT id, task, output, reward FROM episodes
           WHERE session_id = $1
           ORDER BY ts ASC`,
          [sessionId],
        )).rows as any[]
      : (await this.db.query(
          `SELECT id, task, output, reward FROM episodes
           ORDER BY ts ASC
           LIMIT 1000`,
        )).rows as any[];

    if (episodes.length === 0) {
      return { edgesDiscovered: 0, episodesProcessed: 0 };
    }

    const episodeEmbeddings: Float32Array[] = [];
    for (const episode of episodes) {
      const text = `${episode.task}: ${episode.output}`;
      const embedding = await this.embedder.embed(text);
      episodeEmbeddings.push(embedding);
    }

    const dim = episodeEmbeddings.length > 0 ? episodeEmbeddings[0].length : getEmbeddingConfig().dimension;
    const queries = new Float32Array(episodes.length * dim);
    const keys = new Float32Array(episodes.length * dim);
    const values = new Float32Array(episodes.length * dim);

    episodeEmbeddings.forEach((embedding, idx) => {
      queries.set(embedding, idx * dim);
      keys.set(embedding, idx * dim);
      values.set(embedding, idx * dim);
    });

    const attentionResult = await this.attentionService.flashAttention(queries, keys, values);

    let edgesDiscovered = 0;
    const consolidatedEmbeddings = attentionResult.output;

    for (let i = 0; i < episodes.length; i++) {
      const queryEmb = consolidatedEmbeddings.slice(i * dim, (i + 1) * dim);

      const similarities: Array<{ idx: number; score: number }> = [];
      for (let j = 0; j < episodes.length; j++) {
        if (i === j) continue;

        const keyEmb = consolidatedEmbeddings.slice(j * dim, (j + 1) * dim);
        const score = cosineSimilarity(queryEmb, keyEmb);

        if (score >= this.config.minSimilarity) {
          similarities.push({ idx: j, score });
        }
      }

      similarities.sort((a, b) => b.score - a.score);

      for (const { idx, score } of similarities.slice(0, 5)) {
        if (idx > i) {
          const uplift = toNum(episodes[idx].reward) - toNum(episodes[i].reward);

          if (Math.abs(uplift) >= this.config.upliftThreshold) {
            await this.causalGraph.addCausalEdge({
              fromMemoryId: toNum(episodes[i].id),
              fromMemoryType: 'episode',
              toMemoryId: toNum(episodes[idx].id),
              toMemoryType: 'episode',
              similarity: score,
              uplift,
              confidence: score,
              sampleSize: 1,
              mechanism: 'flash_attention_consolidation',
              metadata: {
                consolidationMethod: 'flash_attention',
                blockSize: this.config.flashConfig?.blockSize || 256,
              },
            });

            edgesDiscovered++;
          }
        }
      }
    }

    return {
      edgesDiscovered,
      episodesProcessed: episodes.length,
      metrics: attentionResult.metrics,
    };
  }

  private async discoverCausalEdges(): Promise<number> {
    let discovered = 0;

    const candidatePairs = (await this.db.query(
      `SELECT
         e1.id as from_id,
         e1.task as from_task,
         e1.reward as from_reward,
         e2.id as to_id,
         e2.task as to_task,
         e2.reward as to_reward,
         e2.ts - e1.ts as time_diff
       FROM episodes e1
       JOIN episodes e2 ON e1.session_id = e2.session_id
       WHERE e1.id != e2.id
         AND e2.ts > e1.ts
         AND e2.ts - e1.ts < 3600
       ORDER BY e1.id, e2.ts
       LIMIT 1000`,
    )).rows as any[];

    for (const pair of candidatePairs) {
      const existingRes = await this.db.query(
        `SELECT id FROM causal_edges
         WHERE from_memory_id = $1 AND to_memory_id = $2`,
        [toNum(pair.from_id), toNum(pair.to_id)],
      );

      if (existingRes.rows.length > 0) continue;

      const propensity = await this.calculatePropensity(toNum(pair.from_id));
      const mu1 = await this.calculateOutcomeModel(pair.from_task, true);
      const mu0 = await this.calculateOutcomeModel(pair.from_task, false);

      const a = 1;
      const y = toNum(pair.to_reward);
      const doublyRobustEstimate = (mu1 - mu0) + (a * (y - mu1) / propensity);

      const sampleSize = await this.getSampleSize(pair.from_task);
      const confidence = this.calculateConfidence(sampleSize, doublyRobustEstimate);

      if (Math.abs(doublyRobustEstimate) >= this.config.upliftThreshold && confidence >= this.config.confidenceThreshold) {
        const edge: CausalEdge = {
          fromMemoryId: toNum(pair.from_id),
          fromMemoryType: 'episode',
          toMemoryId: toNum(pair.to_id),
          toMemoryType: 'episode',
          similarity: 0.8,
          uplift: doublyRobustEstimate,
          confidence,
          sampleSize,
          mechanism: `${pair.from_task} → ${pair.to_task} (doubly robust)`,
          metadata: {
            propensity,
            mu1,
            mu0,
            discoveredAt: Date.now()
          }
        };

        await this.causalGraph.addCausalEdge(edge);
        discovered++;
      }
    }

    return discovered;
  }

  private async calculatePropensity(episodeId: number): Promise<number> {
    const episodeRes = await this.db.query(
      'SELECT task, session_id FROM episodes WHERE id = $1',
      [episodeId],
    );
    const episode = episodeRes.rows[0] as any;
    if (!episode) return 0.5;

    const countsRes = await this.db.query(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN task = $1 THEN 1 ELSE 0 END) as task_count
       FROM episodes
       WHERE session_id = $2`,
      [episode.task, episode.session_id],
    );
    const counts = countsRes.rows[0] as any;

    const propensity = toNum(counts.task_count) / Math.max(toNum(counts.total), 1);

    return Math.max(0.01, Math.min(0.99, propensity));
  }

  private async calculateOutcomeModel(task: string, treated: boolean): Promise<number> {
    const avgRewardRes = await this.db.query(
      `SELECT AVG(reward) as avg_reward
       FROM episodes
       WHERE ${treated ? '' : 'NOT'} EXISTS (
         SELECT 1 FROM episodes e2
         WHERE e2.session_id = episodes.session_id
           AND e2.task = $1
           AND e2.ts < episodes.ts
       )`,
      [task],
    );
    const avgReward = avgRewardRes.rows[0] as any;

    return avgReward?.avg_reward != null ? toNum(avgReward.avg_reward) : 0.5;
  }

  private async getSampleSize(task: string): Promise<number> {
    const countRes = await this.db.query(
      `SELECT COUNT(*) as count
       FROM episodes
       WHERE task = $1`,
      [task],
    );
    const count = countRes.rows[0] as any;

    return toNum(count?.count);
  }

  private calculateConfidence(sampleSize: number, uplift: number): number {
    const sampleFactor = Math.min(sampleSize / 100, 1.0);
    const effectSizeFactor = Math.min(Math.abs(uplift) / 0.5, 1.0);

    return sampleFactor * effectSizeFactor;
  }

  private async completeExperiments(): Promise<number> {
    const runningExperiments = (await this.db.query(
      `SELECT id, start_time, sample_size
       FROM causal_experiments
       WHERE status = 'running'
         AND sample_size >= $1`,
      [this.config.minSampleSize],
    )).rows as any[];

    let completed = 0;

    for (const exp of runningExperiments) {
      try {
        await this.causalGraph.calculateUplift(toNum(exp.id));
        completed++;
      } catch (error) {
        console.error(`   ⚠ Failed to calculate uplift for experiment ${exp.id}:`, error);
      }
    }

    return completed;
  }

  /**
   * Create new A/B experiments. HARD path — cross-product self-JOIN +
   * GROUP BY + HAVING. PostgreSQL strict-mode considerations:
   *   - `e1.task`, `e1.id` both in GROUP BY; `COUNT(e2.id)` is aggregate.
   *   - `HAVING COUNT(e2.id) >= $1` is aggregate-pure.
   *   - `ORDER BY COUNT(e2.id) DESC` is the explicit aggregate form.
   *   - `SELECT DISTINCT` is redundant under GROUP BY; kept verbatim.
   */
  private async createExperiments(): Promise<number> {
    const currentExperimentsRes = await this.db.query(
      `SELECT COUNT(*) as count
       FROM causal_experiments
       WHERE status = 'running'`,
    );
    const currentExperiments = currentExperimentsRes.rows[0] as any;

    const available = this.config.experimentBudget - toNum(currentExperiments.count);
    if (available <= 0) {
      return 0;
    }

    const candidates = (await this.db.query(
      `SELECT DISTINCT
         e1.task as treatment_task,
         e1.id as treatment_id,
         COUNT(e2.id) as potential_outcomes
       FROM episodes e1
       JOIN episodes e2 ON e1.session_id = e2.session_id
       WHERE e2.ts > e1.ts
         AND NOT EXISTS (
           SELECT 1 FROM causal_experiments
           WHERE treatment_id = e1.id
         )
       GROUP BY e1.task, e1.id
       HAVING COUNT(e2.id) >= $1
       ORDER BY COUNT(e2.id) DESC
       LIMIT $2`,
      [this.config.minSampleSize, available],
    )).rows as any[];

    let created = 0;

    for (const candidate of candidates) {
      await this.causalGraph.createExperiment({
        name: `Auto: ${candidate.treatment_task} Impact`,
        hypothesis: `${candidate.treatment_task} affects downstream outcomes`,
        treatmentId: toNum(candidate.treatment_id),
        treatmentType: 'episode',
        startTime: Date.now(),
        sampleSize: 0,
        status: 'running',
        metadata: {
          autoGenerated: true,
          potentialOutcomes: toNum(candidate.potential_outcomes)
        }
      });

      created++;
    }

    return created;
  }

  private async pruneEdges(): Promise<number> {
    const maxAgeMs = this.config.edgeMaxAgeDays * 24 * 60 * 60 * 1000;
    // ADR-0170 Phase B (2026-05-12): cutoffTime is bound to a BIGINT column
    // (causal_edges.created_at). `Date.now() / 1000` returns a fractional
    // second (e.g. 1770767409.552); pglite/postgres rejects it with
    // "invalid input syntax for type bigint". Floor to an integer to match
    // the column type before binding.
    const cutoffTime = Math.floor(Date.now() / 1000 - maxAgeMs / 1000);

    const result = await this.db.query(
      `DELETE FROM causal_edges
       WHERE confidence < $1
          OR created_at < $2
       RETURNING id`,
      [this.config.confidenceThreshold, cutoffTime],
    );

    return result.rows.length;
  }

  private async calculateStats(): Promise<{ avgUplift: number; avgConfidence: number }> {
    const statsRes = await this.db.query(
      `SELECT
         AVG(ABS(uplift)) as avg_uplift,
         AVG(confidence) as avg_confidence
       FROM causal_edges
       WHERE uplift IS NOT NULL`,
    );
    const stats = statsRes.rows[0] as any;

    return {
      avgUplift: stats?.avg_uplift != null ? toNum(stats.avg_uplift) : 0,
      avgConfidence: stats?.avg_confidence != null ? toNum(stats.avg_confidence) : 0
    };
  }

  private generateRecommendations(report: LearnerReport): string[] {
    const recommendations: string[] = [];

    if (report.edgesDiscovered === 0) {
      recommendations.push('No new causal edges discovered. Consider collecting more diverse episode data.');
    }

    if (report.avgUplift < 0.1) {
      recommendations.push('Average uplift is low. Review task sequences for optimization opportunities.');
    }

    if (report.avgConfidence < 0.7) {
      recommendations.push('Average confidence is below target. Increase sample sizes or refine hypothesis selection.');
    }

    if (report.experimentsCompleted > 0) {
      recommendations.push(`${report.experimentsCompleted} experiments completed. Review results for actionable insights.`);
    }

    if (report.edgesPruned > report.edgesDiscovered) {
      recommendations.push('More edges pruned than discovered. Consider adjusting confidence thresholds.');
    }

    return recommendations;
  }

  private printReport(report: LearnerReport): void {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Nightly Learner Report');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`  Execution Time: ${report.executionTimeMs}ms`);
    console.log(`  Timestamp: ${new Date(report.timestamp).toISOString()}\n`);
    console.log('  Results:');
    console.log(`    • Edges Discovered: ${report.edgesDiscovered}`);
    console.log(`    • Edges Pruned: ${report.edgesPruned}`);
    console.log(`    • Experiments Completed: ${report.experimentsCompleted}`);
    console.log(`    • Experiments Created: ${report.experimentsCreated}`);
    console.log(`    • Skills Created: ${report.skillsCreated}`);
    console.log(`    • Skills Updated: ${report.skillsUpdated}`);
    console.log(`    • Patterns Extracted: ${report.patternsExtracted}\n`);
    console.log('  Statistics:');
    console.log(`    • Avg Uplift: ${report.avgUplift.toFixed(3)}`);
    console.log(`    • Avg Confidence: ${report.avgConfidence.toFixed(3)}\n`);

    if (report.recommendations.length > 0) {
      console.log('  Recommendations:');
      report.recommendations.forEach(rec => console.log(`    • ${rec}`));
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════\n');
  }

  updateConfig(config: Partial<LearnerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
