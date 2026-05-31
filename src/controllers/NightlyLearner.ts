/**
 * Nightly Learner - Automated Causal Discovery and Consolidation
 *
 * Runs as a background job to:
 * 1. Discover new causal edges from episode patterns
 * 2. Run A/B experiments on promising hypotheses
 * 3. Calculate uplift for completed experiments
 * 4. Prune low-confidence edges
 * 5. Update rerank weights based on performance
 *
 * Based on doubly robust learner:
 * τ̂(x) = μ1(x) − μ0(x) + [a*(y−μ1(x)) / e(x)] − [(1−a)*(y−μ0(x)) / (1−e(x))]
 *
 * v2.0.0-alpha.3 Features:
 * - FlashAttention for memory-efficient episodic consolidation
 * - Block-wise computation for large episode buffers
 * - Feature flag: ENABLE_FLASH_CONSOLIDATION (default: false)
 * - 100% backward compatible with fallback to standard consolidation
 */

// Database type from db-fallback
type Database = any;
import { CausalMemoryGraph, CausalEdge } from './CausalMemoryGraph.js';
import { ReflexionMemory } from './ReflexionMemory.js';
import { SkillLibrary } from './SkillLibrary.js';
import { EmbeddingService } from './EmbeddingService.js';
import { AttentionService, type FlashAttentionConfig } from '../services/AttentionService.js';
import type { MutationContext } from '../archivist/mutation-context.js';
import type { StoreId } from '../archivist/types.js';

// ADR-0181 Item 4 (2026-05-16) — substrate-seam storeIds for the F4-2
// audit-chain wraps below. `agentdb_causal_edge` covers `causal_edges`
// table writes (addCausalEdge + DELETE prune); `agentdb_causal_experiment`
// covers `causal_experiments` writes (createExperiment INSERT +
// calculateUplift UPDATE). Both classify as SQLite carve-out per
// substrate-registry.ts, sharing the `ControllerRegistry.getAgentDB().database`
// handle that `this.db` already references — so the withWrite envelope adds
// audit enrolment without changing where bytes land.
const STORE_CAUSAL_EDGE = 'agentdb_causal_edge' as StoreId;
const STORE_CAUSAL_EXPERIMENT = 'agentdb_causal_experiment' as StoreId;

export interface LearnerConfig {
  minSimilarity: number; // Min similarity to consider for causal edge (default: 0.7)
  minSampleSize: number; // Min observations for uplift calculation (default: 30)
  confidenceThreshold: number; // Min confidence to keep edge (default: 0.6)
  upliftThreshold: number; // Min absolute uplift to consider significant (default: 0.05)
  pruneOldEdges: boolean; // Remove edges older than X days (default: true)
  edgeMaxAgeDays: number; // Max age for edges (default: 90)
  autoExperiments: boolean; // Automatically create A/B experiments (default: true)
  experimentBudget: number; // Max experiments to run concurrently (default: 10)

  // v2 features
  /** Enable FlashAttention for consolidation (default: false) */
  ENABLE_FLASH_CONSOLIDATION?: boolean;
  /** FlashAttention configuration */
  flashConfig?: Partial<FlashAttentionConfig>;
}

/**
 * ADR-0279: action-value — E[reward | action, task_type] over the episode
 * stream. `action` is the model/agent actually used (episodes.action). `uplift`
 * is the de-confounded signal routers consume: the action's mean reward minus
 * the task-type baseline (the mean over ALL actions for that task_type).
 */
export interface ActionValue {
  action: string;
  taskType: string | null;
  meanReward: number;     // E[reward | action, task_type]
  samples: number;
  baselineReward: number; // E[reward | task_type] over all actions of that type
  uplift: number;         // meanReward − baselineReward
  confidence: number;     // min(samples / minSampleSize, 1) — ramps with evidence
}

export interface LearnerReport {
  timestamp: number;
  executionTimeMs: number;
  edgesDiscovered: number;
  edgesPruned: number;
  experimentsCompleted: number;
  experimentsCreated: number;
  skillsCreated: number;
  skillsUpdated: number;
  avgUplift: number;
  avgConfidence: number;
  recommendations: string[];
  actionValues?: ActionValue[]; // ADR-0279: E[reward | action, task_type] snapshot
}

export class NightlyLearner {
  private db: Database;
  private causalGraph: CausalMemoryGraph;
  private reflexion: ReflexionMemory;
  private skillLibrary: SkillLibrary;
  private embedder: EmbeddingService;
  private attentionService?: AttentionService;

  constructor(
    db: Database,
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
    }
  ) {
    this.db = db;
    this.embedder = embedder;
    this.causalGraph = new CausalMemoryGraph(db);
    this.reflexion = new ReflexionMemory(db, embedder);
    this.skillLibrary = new SkillLibrary(db, embedder);

    // Initialize AttentionService if FlashAttention enabled
    if (this.config.ENABLE_FLASH_CONSOLIDATION) {
      this.attentionService = new AttentionService(db, {
        flash: {
          enabled: true,
          ...this.config.flashConfig,
        },
      });
    }
  }

  /**
   * Main learning job - runs all discovery and consolidation tasks.
   *
   * ADR-0180 §Re-entrancy: each child controller invocation runs in its own
   * `ctx.child(reason)` so the audit chain reconstructs as a tree
   * (root → causal/experiment/skill/reflexion/prune). Per ADR-0180 Phase 9
   * Scenario A the resulting tree depth must remain ≤ 3.
   *
   * The bodies inside each `ctx.child(...)` step are intentionally TODO stubs
   * that fall back to the legacy direct-controller call path — substrate-seam
   * wire-up (routing through `_childCtx.substrate.withWrite`) lands in F4-2.
   */
  async run(ctx?: MutationContext): Promise<LearnerReport> {
    console.log('\n🌙 Nightly Learner Starting...\n');
    const startTime = Date.now();

    const report: LearnerReport = {
      timestamp: startTime,
      executionTimeMs: 0,
      edgesDiscovered: 0,
      edgesPruned: 0,
      experimentsCompleted: 0,
      experimentsCreated: 0,
      skillsCreated: 0,
      skillsUpdated: 0,
      avgUplift: 0,
      avgConfidence: 0,
      recommendations: []
    };

    try {
      // Step 1: Discover new causal edges — `causal` child for the audit tree.
      console.log('📊 Discovering causal edges from episode patterns...');
      const causalCtx = ctx?.child('causal');
      report.edgesDiscovered = await this.discoverCausalEdges(causalCtx);
      console.log(`   ✓ Discovered ${report.edgesDiscovered} new edges\n`);

      // Step 2: Complete running experiments — `experiment` child (calculateUplift writes).
      console.log('🧪 Completing A/B experiments...');
      const completeCtx = ctx?.child('experiment');
      report.experimentsCompleted = await this.completeExperiments(completeCtx);
      console.log(`   ✓ Completed ${report.experimentsCompleted} experiments\n`);

      // Step 3: Create new experiments (if enabled) — separate `experiment` child.
      if (this.config.autoExperiments) {
        console.log('🔬 Creating new A/B experiments...');
        const createCtx = ctx?.child('experiment');
        report.experimentsCreated = await this.createExperiments(createCtx);
        console.log(`   ✓ Created ${report.experimentsCreated} new experiments\n`);
      }

      // Step 4: Prune low-confidence edges — `prune` child wrapping the DELETE.
      if (this.config.pruneOldEdges) {
        console.log('🧹 Pruning low-confidence edges...');
        const pruneCtx = ctx?.child('prune');
        report.edgesPruned = await this.pruneEdges(pruneCtx);
        console.log(`   ✓ Pruned ${report.edgesPruned} edges\n`);
      }

      // Step 5: Consolidate high-reward episodes into skills — `skill` child for
      // the audit tree (ADR-0180 §Re-entrancy / Phase 9). Restores the episode→
      // skill promotion lost in the ADR-0085 bridge deletion (ADR-0179 row 6):
      // the per-feedback skills.promote() is gone; the ADR-0177 re-convergence's
      // batch model is consolidateEpisodesIntoSkills over the episodes table.
      // The optional `skill` ctx wraps the writes in the substrate-seam audit
      // envelope when a caller mints a MutationContext; today callers pass none
      // (no-op) and the writes flow through SkillLibrary's legacy SQLite path.
      // Episode RECORDING stays a separate concern (the agentdb_reflexion-store
      // tool path) — run() consumes episodes, it does not produce them.
      console.log('🎓 Consolidating high-reward episodes into skills...');
      const skillCtx = ctx?.child('skill');
      const consolidation = await this.skillLibrary.consolidateEpisodesIntoSkills({}, skillCtx);
      report.skillsCreated = consolidation.created;
      report.skillsUpdated = consolidation.updated;
      console.log(`   ✓ Created ${report.skillsCreated} skills, updated ${report.skillsUpdated}\n`);

      // Step 6: Calculate statistics
      const stats = this.calculateStats();
      report.avgUplift = stats.avgUplift;
      report.avgConfidence = stats.avgConfidence;

      // Step 6b (ADR-0279): snapshot E[reward | action, task_type] so routers
      // can consume action-value uplift (model/agent) from the same loop.
      report.actionValues = this.computeActionValues();

      // Step 7: Generate recommendations
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

  /**
   * ADR-0279: E[reward | action, task_type] over the episode stream — the
   * action-value the routers consume (model-uplift for the ModelRouter,
   * agent-uplift for default routing). `action` (episodes.action) is the
   * model/agent actually used. Unlike the marginal E[reward | model] the
   * ModelRouter learns from its own loop, this is keyed by the action AND the
   * task-type, and reports `uplift` = mean(action, type) − baseline(type) (the
   * de-confounded "what does doing X cause for THIS kind of task").
   *
   * Rows below `minSamples` (default 1) are dropped; `confidence` ramps to 1 at
   * the learner's `minSampleSize`. Optional `taskType` filters to one type.
   */
  computeActionValues(opts?: { taskType?: string; minSamples?: number }): ActionValue[] {
    const minSamples = Math.max(1, opts?.minSamples ?? 1);
    const typeFilter = opts?.taskType ? 'AND task_type = ?' : '';

    // Per-task-type baseline: mean reward over ALL actioned episodes of that type.
    const baseParams = opts?.taskType ? [opts.taskType] : [];
    const baseRows = this.db.prepare(`
      SELECT COALESCE(task_type, '') AS tt, AVG(reward) AS base
      FROM episodes
      WHERE action IS NOT NULL ${typeFilter}
      GROUP BY COALESCE(task_type, '')
    `).all(...baseParams) as Array<{ tt: string; base: number }>;
    const baseline = new Map<string, number>();
    for (const r of baseRows) baseline.set(r.tt, r.base);

    // Per-(action, task_type) value.
    const valueParams = opts?.taskType ? [opts.taskType, minSamples] : [minSamples];
    const rows = this.db.prepare(`
      SELECT action, COALESCE(task_type, '') AS tt, AVG(reward) AS mean, COUNT(*) AS n
      FROM episodes
      WHERE action IS NOT NULL ${typeFilter}
      GROUP BY action, COALESCE(task_type, '')
      HAVING COUNT(*) >= ?
      ORDER BY mean DESC
    `).all(...valueParams) as Array<{ action: string; tt: string; mean: number; n: number }>;

    const minSampleSize = this.config.minSampleSize || 30;
    return rows.map((r) => {
      const base = baseline.get(r.tt) ?? r.mean;
      return {
        action: r.action,
        taskType: r.tt === '' ? null : r.tt,
        meanReward: r.mean,
        samples: r.n,
        baselineReward: base,
        uplift: r.mean - base,
        confidence: Math.min(r.n / minSampleSize, 1),
      };
    });
  }

  /**
   * Discover causal edges using doubly robust learner
   *
   * τ̂(x) = μ1(x) − μ0(x) + [a*(y−μ1(x)) / e(x)] − [(1−a)*(y−μ0(x)) / (1−e(x))]
   *
   * Where:
   * - μ1(x) = outcome model for treatment
   * - μ0(x) = outcome model for control
   * - e(x) = propensity score (probability of treatment)
   * - a = treatment indicator
   * - y = observed outcome
   *
   * v2: Uses FlashAttention for memory-efficient consolidation if enabled
   *
   * ADR-0220 F-05-001: previously returned [] for all non-dry-run calls even
   * though discoverCausalEdges() had persisted edges. Fixed: run discovery,
   * then re-query the persisted edges and return them.
   */
  async discover(config: {
    minAttempts?: number;
    minSuccessRate?: number;
    minConfidence?: number;
    dryRun?: boolean;
  }): Promise<CausalEdge[]> {
    // If dryRun, return empty array without persisting anything
    if (config.dryRun) {
      return [];
    }

    // ADR-0220 F-05-001 fix: run discovery (persists edges) then re-query
    // the newly created edges so callers receive the real array, not [].
    // discoverCausalEdges returns only a count; re-querying is the
    // minimal-change path that avoids refactoring the private helper.
    const beforeCount = (this.db.prepare('SELECT COUNT(*) as c FROM causal_edges').get() as any)?.c ?? 0;
    await this.discoverCausalEdges();
    const afterCount = (this.db.prepare('SELECT COUNT(*) as c FROM causal_edges').get() as any)?.c ?? 0;

    if (afterCount <= beforeCount) {
      return [];
    }

    // Re-query the edges created by this run (newest N rows by id).
    const newEdges = this.db.prepare(`
      SELECT * FROM causal_edges ORDER BY id DESC LIMIT ?
    `).all(afterCount - beforeCount) as CausalEdge[];

    return newEdges;
  }

  /**
   * Consolidate episodic memories using FlashAttention (v2 feature)
   *
   * Processes large episode buffers efficiently using block-wise computation.
   * Identifies patterns and relationships across episodes for causal edge discovery.
   *
   * @param sessionId - Session to consolidate (optional, processes all if not provided)
   * @param _childCtx - ADR-0181 Item 4 forward-compatible audit-chain handle.
   *   When supplied, each per-pair `addCausalEdge` write is wrapped in a
   *   substrate-seam `withWrite` envelope so the discovered edges enrol
   *   under the parent dispatch's audit subtree. Today no caller passes
   *   one (cli `agentdb_learner_run` invokes `learner.run()` with no ctx,
   *   and `routeSessionOp`'s `consolidate` branch is dead per task #88's
   *   misnamed-method bug); the parameter exists so the contract is
   *   recorded in code, activating the moment a caller mints a ctx.
   * @returns Number of edges discovered through consolidation
   */
  async consolidateEpisodes(
    sessionId?: string,
    _childCtx?: MutationContext,
  ): Promise<{
    edgesDiscovered: number;
    episodesProcessed: number;
    metrics?: {
      computeTimeMs: number;
      peakMemoryMB: number;
      blocksProcessed: number;
    };
  }> {
    if (!this.attentionService) {
      // ADR-0220 F-05-024: previously returned episodesProcessed:0 even though
      // discoverCausalEdges() evaluated up to 1000 candidate pairs. Fixed:
      // count the candidate pairs from the same query the helper uses, so
      // episodesProcessed reflects the actual work done.
      const candidatesProcessed = (this.db.prepare(`
        SELECT COUNT(*) as c
        FROM episodes e1
        JOIN episodes e2 ON e1.session_id = e2.session_id
        WHERE e1.id != e2.id
          AND e2.ts > e1.ts
          AND e2.ts - e1.ts < 3600
      `).get() as any)?.c ?? 0;

      const edgesDiscovered = await this.discoverCausalEdges();
      return {
        edgesDiscovered,
        episodesProcessed: Math.min(candidatesProcessed, 1000),
      };
    }

    // Get episodes to consolidate
    const episodes = sessionId
      ? this.db.prepare(`
          SELECT id, task, output, reward FROM episodes
          WHERE session_id = ?
          ORDER BY ts ASC
        `).all(sessionId) as any[]
      : this.db.prepare(`
          SELECT id, task, output, reward FROM episodes
          ORDER BY ts ASC
          LIMIT 1000
        `).all() as any[];

    if (episodes.length === 0) {
      return { edgesDiscovered: 0, episodesProcessed: 0 };
    }

    // Generate embeddings for all episodes
    const episodeEmbeddings: Float32Array[] = [];
    for (const episode of episodes) {
      const text = `${episode.task}: ${episode.output}`;
      const embedding = await this.embedder.embed(text);
      episodeEmbeddings.push(embedding);
    }

    // Prepare queries (each episode is a query)
    const dim = 384;
    const queries = new Float32Array(episodes.length * dim);
    const keys = new Float32Array(episodes.length * dim);
    const values = new Float32Array(episodes.length * dim);

    episodeEmbeddings.forEach((embedding, idx) => {
      queries.set(embedding, idx * dim);
      keys.set(embedding, idx * dim);
      values.set(embedding, idx * dim);
    });

    // Apply FlashAttention for memory-efficient consolidation
    const attentionResult = await this.attentionService.flashAttention(queries, keys, values);

    // Analyze attention output to discover causal relationships
    let edgesDiscovered = 0;
    const consolidatedEmbeddings = attentionResult.output;

    // For each episode, find similar episodes in consolidated space
    for (let i = 0; i < episodes.length; i++) {
      const queryEmb = consolidatedEmbeddings.slice(i * dim, (i + 1) * dim);

      // Find top-k similar episodes
      const similarities: Array<{ idx: number; score: number }> = [];
      for (let j = 0; j < episodes.length; j++) {
        if (i === j) continue;

        const keyEmb = consolidatedEmbeddings.slice(j * dim, (j + 1) * dim);
        const score = this.cosineSimilarity(queryEmb, keyEmb);

        if (score >= this.config.minSimilarity) {
          similarities.push({ idx: j, score });
        }
      }

      // Sort by similarity
      similarities.sort((a, b) => b.score - a.score);

      // Create causal edges for top matches
      for (const { idx, score } of similarities.slice(0, 5)) {
        // Only create edge if temporal sequence is correct
        if (idx > i) {
          const uplift = episodes[idx].reward - episodes[i].reward;

          if (Math.abs(uplift) >= this.config.upliftThreshold) {
            const edge = {
              fromMemoryId: episodes[i].id,
              fromMemoryType: 'episode' as const,
              toMemoryId: episodes[idx].id,
              toMemoryType: 'episode' as const,
              similarity: score,
              uplift,
              confidence: score,
              sampleSize: 1,
              mechanism: 'flash_attention_consolidation',
              metadata: {
                consolidationMethod: 'flash_attention',
                blockSize: this.config.flashConfig?.blockSize || 256,
              },
            };

            // ADR-0181 Item 4 substrate-seam wrap. `this.db` and the
            // substrate's SQLite handle are the same `ControllerRegistry
            // .getAgentDB().database` instance (controller-registry.ts:1599),
            // so the withWrite envelope adds audit enrolment without
            // changing where bytes land. Legacy direct path remains for
            // ctx-less callers (today, all of them).
            if (_childCtx) {
              await _childCtx.substrate.withWrite(
                { storeId: STORE_CAUSAL_EDGE },
                async (_handle) => {
                  await this.causalGraph.addCausalEdge(edge);
                },
              );
            } else {
              await this.causalGraph.addCausalEdge(edge);
            }

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

  /**
   * Helper: Cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dotProduct / denom;
  }

  private async discoverCausalEdges(_childCtx?: MutationContext): Promise<number> {
    // ADR-0181 Item 4 (2026-05-16) — F4-2 substrate-seam wrap landed.
    // Per-pair `addCausalEdge` calls below now route through
    // `_childCtx.substrate.withWrite({ storeId: STORE_CAUSAL_EDGE }, ...)`
    // when the parent passes a ctx, so the audit chain records each
    // discovered edge under the parent `causal` child. The substrate's
    // SQLite handle and `this.db` reference the same
    // `ControllerRegistry.getAgentDB().database` instance
    // (controller-registry.ts:1599), so the wrap adds audit enrolment
    // without changing where bytes land. The legacy direct path remains
    // for the no-ctx case (cli `agentdb_learner_run` invokes
    // `learner.run()` with no arg today, so every wrap below is dead
    // code at the live entry point — the contract is recorded in code,
    // activating the moment a caller mints a ctx).
    let discovered = 0;

    // Find episode pairs with high similarity and temporal sequence
    const candidatePairs = this.db.prepare(`
      SELECT
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
        AND e2.ts - e1.ts < 3600 -- Within 1 hour
      ORDER BY e1.id, e2.ts
      LIMIT 1000
    `).all() as any[];

    // Better-sqlite3 best practice: Prepare statements OUTSIDE loops for better performance
    const checkExistingStmt = this.db.prepare(`
      SELECT id FROM causal_edges
      WHERE from_memory_id = ? AND to_memory_id = ?
    `);

    for (const pair of candidatePairs) {
      // Check if edge already exists
      const existing = checkExistingStmt.get(pair.from_id, pair.to_id);

      if (existing) continue;

      // Calculate propensity score e(x) - probability of treatment
      // Simplified: use frequency of from_task in session
      const propensity = this.calculatePropensity(pair.from_id);

      // Calculate outcome models μ1(x) and μ0(x)
      const mu1 = this.calculateOutcomeModel(pair.from_task, true);  // With treatment
      const mu0 = this.calculateOutcomeModel(pair.from_task, false); // Without treatment

      // Calculate doubly robust estimator
      const a = 1; // This is a treated observation
      const y = pair.to_reward;
      const doublyRobustEstimate = (mu1 - mu0) + (a * (y - mu1) / propensity);

      // Calculate confidence based on sample size and variance
      const sampleSize = this.getSampleSize(pair.from_task);
      const confidence = this.calculateConfidence(sampleSize, doublyRobustEstimate);

      // Only add if meets thresholds
      if (Math.abs(doublyRobustEstimate) >= this.config.upliftThreshold && confidence >= this.config.confidenceThreshold) {
        const edge: CausalEdge = {
          fromMemoryId: pair.from_id,
          fromMemoryType: 'episode',
          toMemoryId: pair.to_id,
          toMemoryType: 'episode',
          similarity: 0.8, // Simplified - would use embedding similarity in production
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

        if (_childCtx) {
          await _childCtx.substrate.withWrite(
            { storeId: STORE_CAUSAL_EDGE },
            async (_handle) => {
              await this.causalGraph.addCausalEdge(edge);
            },
          );
        } else {
          await this.causalGraph.addCausalEdge(edge);
        }
        discovered++;
      }
    }

    return discovered;
  }

  /**
   * Calculate propensity score e(x) - probability of treatment given context
   */
  private calculatePropensity(episodeId: number): number {
    const episode = this.db.prepare('SELECT task, session_id FROM episodes WHERE id = ?').get(episodeId) as any;

    // Count occurrences of this task type in session
    const counts = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN task = ? THEN 1 ELSE 0 END) as task_count
      FROM episodes
      WHERE session_id = ?
    `).get(episode.task, episode.session_id) as any;

    const propensity = counts.task_count / Math.max(counts.total, 1);

    // Clip to avoid division by zero
    return Math.max(0.01, Math.min(0.99, propensity));
  }

  /**
   * Calculate outcome model μ(x) - expected outcome given treatment status
   */
  private calculateOutcomeModel(task: string, treated: boolean): number {
    // Get average reward for episodes with/without this task in their history
    const avgReward = this.db.prepare(`
      SELECT AVG(reward) as avg_reward
      FROM episodes
      WHERE ${treated ? '' : 'NOT'} EXISTS (
        SELECT 1 FROM episodes e2
        WHERE e2.session_id = episodes.session_id
          AND e2.task = ?
          AND e2.ts < episodes.ts
      )
    `).get(task) as any;

    return avgReward?.avg_reward || 0.5;
  }

  /**
   * Get sample size for a task type
   */
  private getSampleSize(task: string): number {
    const count = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM episodes
      WHERE task = ?
    `).get(task) as any;

    return count.count;
  }

  /**
   * Calculate confidence based on sample size and effect size
   */
  private calculateConfidence(sampleSize: number, uplift: number): number {
    // Simplified confidence calculation
    // In production, use proper statistical methods (bootstrap, etc.)

    const sampleFactor = Math.min(sampleSize / 100, 1.0); // Max at 100 samples
    const effectSizeFactor = Math.min(Math.abs(uplift) / 0.5, 1.0); // Max at 0.5 uplift

    return sampleFactor * effectSizeFactor;
  }

  /**
   * Complete running A/B experiments and calculate uplift
   */
  private async completeExperiments(_childCtx?: MutationContext): Promise<number> {
    // ADR-0181 Item 4 (2026-05-16) — F4-2 substrate-seam wrap landed.
    // `calculateUplift` UPDATEs `causal_experiments`, hence the
    // `STORE_CAUSAL_EXPERIMENT` storeId (distinct from `STORE_CAUSAL_EDGE`
    // so per-storeId invariants can target the experiments table
    // separately even though both share the same SQLite handle). Wrap
    // is per-experiment so a single failed uplift in a batch records as
    // its own audit entry under the parent `experiment` child.
    // Better-sqlite3 best practice: Prepare statements OUTSIDE loops for better performance
    const runningExperiments = this.db.prepare(`
      SELECT id, start_time, sample_size
      FROM causal_experiments
      WHERE status = 'running'
        AND sample_size >= ?
    `).all(this.config.minSampleSize) as any[];

    let completed = 0;

    for (const exp of runningExperiments) {
      try {
        if (_childCtx) {
          await _childCtx.substrate.withWrite(
            { storeId: STORE_CAUSAL_EXPERIMENT },
            async (_handle) => {
              this.causalGraph.calculateUplift(exp.id);
            },
          );
        } else {
          this.causalGraph.calculateUplift(exp.id);
        }
        completed++;
      } catch (error) {
        console.error(`   ⚠ Failed to calculate uplift for experiment ${exp.id}:`, error);
      }
    }

    return completed;
  }

  /**
   * Create new A/B experiments for promising hypotheses
   */
  private async createExperiments(_childCtx?: MutationContext): Promise<number> {
    // ADR-0181 Item 4 (2026-05-16) — F4-2 substrate-seam wrap landed.
    // `createExperiment` INSERTs `causal_experiments`, same storeId as
    // `completeExperiments` above. Each new experiment row becomes a
    // leaf entry under the parent `experiment` child's audit subtree.
    const currentExperiments = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM causal_experiments
      WHERE status = 'running'
    `).get() as any;

    const available = this.config.experimentBudget - currentExperiments.count;
    if (available <= 0) {
      return 0;
    }

    // Find promising task pairs that don't have experiments yet
    const candidates = this.db.prepare(`
      SELECT DISTINCT
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
      HAVING COUNT(e2.id) >= ?
      ORDER BY COUNT(e2.id) DESC
      LIMIT ?
    `).all(this.config.minSampleSize, available) as any[];

    let created = 0;

    for (const candidate of candidates) {
      const experiment = {
        name: `Auto: ${candidate.treatment_task} Impact`,
        hypothesis: `${candidate.treatment_task} affects downstream outcomes`,
        treatmentId: candidate.treatment_id,
        treatmentType: 'episode' as const,
        startTime: Date.now(),
        sampleSize: 0,
        status: 'running' as const,
        metadata: {
          autoGenerated: true,
          potentialOutcomes: candidate.potential_outcomes
        }
      };

      if (_childCtx) {
        await _childCtx.substrate.withWrite(
          { storeId: STORE_CAUSAL_EXPERIMENT },
          async (_handle) => {
            this.causalGraph.createExperiment(experiment);
          },
        );
      } else {
        this.causalGraph.createExperiment(experiment);
      }

      created++;
    }

    return created;
  }

  /**
   * Prune old or low-confidence edges
   */
  private async pruneEdges(_childCtx?: MutationContext): Promise<number> {
    // ADR-0181 Item 4 (2026-05-16) — F4-2 substrate-seam wrap landed.
    // The bulk DELETE records as a single audit entry under the parent
    // `prune` child instead of bypassing the archivist seam.
    const maxAgeMs = this.config.edgeMaxAgeDays * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() / 1000 - maxAgeMs / 1000;

    const exec = (): number => {
      const result = this.db.prepare(`
        DELETE FROM causal_edges
        WHERE confidence < ?
          OR created_at < ?
      `).run(this.config.confidenceThreshold, cutoffTime);
      return result.changes;
    };

    if (_childCtx) {
      let changes = 0;
      await _childCtx.substrate.withWrite(
        { storeId: STORE_CAUSAL_EDGE },
        async (_handle) => {
          changes = exec();
        },
      );
      return changes;
    }
    return exec();
  }

  /**
   * Calculate overall statistics
   */
  private calculateStats(): { avgUplift: number; avgConfidence: number } {
    const stats = this.db.prepare(`
      SELECT
        AVG(ABS(uplift)) as avg_uplift,
        AVG(confidence) as avg_confidence
      FROM causal_edges
      WHERE uplift IS NOT NULL
    `).get() as any;

    return {
      avgUplift: stats?.avg_uplift || 0,
      avgConfidence: stats?.avg_confidence || 0
    };
  }

  /**
   * Generate recommendations based on learning results
   */
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

  /**
   * Print report to console
   */
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
    console.log(`    • Skills Updated: ${report.skillsUpdated}\n`);
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

  /**
   * Update learner configuration
   */
  updateConfig(config: Partial<LearnerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
