/**
 * Learning System - Reinforcement Learning Session Management
 *
 * Manages RL training sessions with:
 * - Session lifecycle (start/end)
 * - Action prediction with confidence scores
 * - Feedback loop for policy learning
 * - Policy training with configurable parameters
 *
 * Supports 9 RL algorithms:
 * - Q-Learning
 * - SARSA
 * - Deep Q-Network (DQN)
 * - Policy Gradient
 * - Actor-Critic
 * - Proximal Policy Optimization (PPO)
 * - Decision Transformer
 * - Monte Carlo Tree Search (MCTS)
 * - Model-Based RL
 *
 * ADR-0181 Item 5 (2026-05-16): reverted from PostgresBackend (pglite, ADR-0170
 * Phase B.6) to better-sqlite3. Postgres was retired by ADR-0177 (RVF-first
 * single-node fork); LearningSystem was the last controller still importing it.
 * The four `learning_*` tables now live in schemas/schema.sql alongside
 * episodes/skills/hierarchical_memory and are provisioned by AgentDB.loadSchemas
 * at boot — schemaReady gate is gone. Postgres-specific operators translated:
 * `((metadata::jsonb)->>'latency_ms')::numeric` -> `CAST(json_extract(metadata,
 * '$.latency_ms') AS REAL)`; `TO_CHAR(TO_TIMESTAMP(timestamp/1000.0),
 * 'YYYY-MM-DD')` -> `strftime('%Y-%m-%d', timestamp/1000, 'unixepoch')` (with
 * the bucket expression repeated verbatim in GROUP BY for SELECT-alias parity);
 * `RETURNING id` -> `lastInsertRowid`.
 */

import { EmbeddingService } from './EmbeddingService.js';
import { RuVectorLearning, LearningConfig as GNNConfig } from '../backends/ruvector/RuVectorLearning.js';
import { SonaTrajectoryService } from '../services/SonaTrajectoryService.js';
import { GNNService } from '../services/GNNService.js';
import { getEmbeddingConfig } from '../core/config-chain.js';

// Database type from db-fallback (matches HierarchicalMemory / NightlyLearner pattern)
type Database = any;

export interface LearningSession {
  id: string;
  userId: string;
  sessionType: 'q-learning' | 'sarsa' | 'dqn' | 'policy-gradient' | 'actor-critic' | 'ppo' | 'decision-transformer' | 'mcts' | 'model-based';
  config: LearningConfig;
  startTime: number;
  endTime?: number;
  status: 'active' | 'completed' | 'failed';
  metadata?: Record<string, any>;
}

export interface LearningConfig {
  learningRate: number;
  discountFactor: number;
  explorationRate?: number;
  batchSize?: number;
  targetUpdateFrequency?: number;
}

export interface ActionPrediction {
  action: string;
  confidence: number;
  qValue?: number;
  alternatives: Array<{ action: string; confidence: number; qValue?: number }>;
}

export interface ActionFeedback {
  sessionId: string;
  action: string;
  state: string;
  reward: number;
  nextState?: string;
  success: boolean;
  timestamp: number;
}

export interface TrainingResult {
  epochsCompleted: number;
  finalLoss: number;
  avgReward: number;
  convergenceRate: number;
  trainingTimeMs: number;
}

// ADR-0076 A4: Dual-instance guard — prevent duplicate construction
// when both ControllerRegistry and AgentDBService create this controller
let _singleton: InstanceType<typeof LearningSystem> | null = null;

export class LearningSystem {
  // ADR-0076 A4: definite-assignment due to _singleton early-return pattern in ctor
  private db!: Database;
  private embedder!: EmbeddingService;
  private activeSessions: Map<string, LearningSession> = new Map();

  // Phase 2: RuVector GNN and Sona integration
  private gnnLearning: RuVectorLearning | null = null;
  private sonaService: SonaTrajectoryService | null = null;
  private gnnService: GNNService | null = null;
  private gnnEnabled: boolean = false;
  private sonaEnabled: boolean = false;

  static _resetSingleton(): void { _singleton = null; }

  constructor(db: Database, embedder: EmbeddingService) {
    if (_singleton) {
      if (process.env.CLAUDE_FLOW_DEBUG) {
        console.warn(`[${this.constructor.name}] Duplicate construction detected — returning existing instance`);
      }
      return _singleton as any;
    }
    _singleton = this;
    this.db = db;
    this.embedder = embedder;
    this.initializeRuVectorEnhancements().catch(err => {
      console.warn('[LearningSystem] RuVector enhancements unavailable:', err.message);
    });
  }

  /**
   * Initialize RuVector GNN and Sona enhancements
   */
  private async initializeRuVectorEnhancements(): Promise<void> {
    // Try to initialize GNN-enhanced learning
    try {
      const gnnConfig: GNNConfig = {
        inputDim: getEmbeddingConfig().dimension,
        hiddenDim: 256,
        heads: 4,
        dropout: 0.1
      };

      this.gnnLearning = new RuVectorLearning(gnnConfig);
      await this.gnnLearning.initialize();
      this.gnnEnabled = true;
      console.log('✅ [LearningSystem] GNN-enhanced learning enabled (@ruvector/gnn)');
    } catch (error) {
      console.warn('[LearningSystem] GNN unavailable, using standard learning');
      this.gnnEnabled = false;
    }

    // Try to initialize Sona trajectory service.
    //
    // INTENTIONAL SPLIT (ADR-0181 Item 6, 2026-05-16): zero-arg construction
    // here is correct — this is LearningSystem's PRIVATE Sona instance for
    // its own RL machinery, and durability of that private corpus is not an
    // Item 6 win. The cli's `controller-registry.ts` constructs a SEPARATE
    // SonaTrajectoryService with `{ getDb }` lazy SQLite handle for the
    // user-facing `agentdb_sona_trajectory_store` MCP tool path. Both are
    // valid; do not collapse them.
    try {
      this.sonaService = new SonaTrajectoryService();
      const initialized = await this.sonaService.initialize();
      this.sonaEnabled = initialized;

      if (initialized) {
        console.log(`[LearningSystem] Sona RL trajectory learning enabled (engine: ${this.sonaService.getEngineType()})`);
      } else {
        console.warn('[LearningSystem] Sona unavailable, using in-memory trajectories');
      }
    } catch (error) {
      console.warn('[LearningSystem] Sona service initialization failed');
      this.sonaEnabled = false;
    }

    // Try to initialize GNNService for intent classification
    try {
      this.gnnService = new GNNService({ inputDim: getEmbeddingConfig().dimension, hiddenDim: 128, outputDim: 64, heads: 8 });
      await this.gnnService.initialize();
      console.log(`[LearningSystem] GNNService initialized (engine: ${this.gnnService.getEngineType()})`);
    } catch (error) {
      console.warn('[LearningSystem] GNNService initialization failed');
      this.gnnService = null;
    }
  }

  /**
   * Get engine types for all RuVector integrations
   */
  getEngineTypes(): Record<string, string> {
    return {
      gnn: this.gnnEnabled ? (this.gnnLearning?.getState().initialized ? 'native' : 'js') : 'disabled',
      sona: this.sonaEnabled ? (this.sonaService?.getEngineType() || 'js') : 'disabled',
      gnnService: this.gnnService?.getEngineType() || 'disabled',
    };
  }

  /**
   * Start a new learning session
   */
  async startSession(
    userId: string,
    sessionType: LearningSession['sessionType'],
    config: LearningConfig
  ): Promise<string> {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const session: LearningSession = {
      id: sessionId,
      userId,
      sessionType,
      config,
      startTime: Date.now(),
      status: 'active',
    };

    // Store session in database
    this.db.prepare(
      `INSERT INTO learning_sessions (id, user_id, session_type, config, start_time, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      session.id,
      session.userId,
      session.sessionType,
      JSON.stringify(session.config),
      session.startTime,
      session.status,
    );

    // Cache in memory
    this.activeSessions.set(sessionId, session);

    console.log(`✅ Learning session started: ${sessionId} (${sessionType})`);
    return sessionId;
  }

  /**
   * End a learning session and save final policy
   */
  async endSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId) || await this.getSession(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.status === 'completed') {
      throw new Error(`Session already completed: ${sessionId}`);
    }

    const endTime = Date.now();

    // Save final policy
    await this.savePolicy(sessionId);

    // Update session status
    this.db.prepare(
      `UPDATE learning_sessions
       SET status = 'completed', end_time = ?
       WHERE id = ?`,
    ).run(endTime, sessionId);

    // Update memory cache
    session.endTime = endTime;
    session.status = 'completed';

    // Remove from active sessions
    this.activeSessions.delete(sessionId);

    console.log(`✅ Learning session ended: ${sessionId} (duration: ${endTime - session.startTime}ms)`);
  }

  /**
   * Predict next action with confidence scores
   */
  async predict(sessionId: string, state: string): Promise<ActionPrediction> {
    const session = this.activeSessions.get(sessionId) || await this.getSession(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.status !== 'active') {
      throw new Error(`Session not active: ${sessionId}`);
    }

    // Get or create state embedding
    const stateEmbedding = await this.getStateEmbedding(sessionId, state);

    // Get policy for this session
    const policy = await this.getLatestPolicy(sessionId);

    // Calculate Q-values for all actions
    const actionScores = await this.calculateActionScores(
      session,
      state,
      stateEmbedding,
      policy
    );

    // Sort by score (highest first)
    const sortedActions = actionScores.sort((a, b) => b.score - a.score);

    // Epsilon-greedy exploration
    const explorationRate = session.config.explorationRate || 0.1;
    let selectedAction = sortedActions[0];

    if (Math.random() < explorationRate) {
      // Explore: random action
      selectedAction = sortedActions[Math.floor(Math.random() * sortedActions.length)];
    }

    // Normalize confidence scores to [0, 1]
    const maxScore = sortedActions[0].score;
    const minScore = sortedActions[sortedActions.length - 1].score;
    const scoreRange = maxScore - minScore || 1;

    return {
      action: selectedAction.action,
      confidence: (selectedAction.score - minScore) / scoreRange,
      qValue: selectedAction.score,
      alternatives: sortedActions.slice(1, 4).map(a => ({
        action: a.action,
        confidence: (a.score - minScore) / scoreRange,
        qValue: a.score,
      })),
    };
  }

  /**
   * Submit feedback for learning
   */
  async submitFeedback(feedback: ActionFeedback): Promise<void> {
    const session = this.activeSessions.get(feedback.sessionId) || await this.getSession(feedback.sessionId);

    if (!session) {
      throw new Error(`Session not found: ${feedback.sessionId}`);
    }

    // Store experience in database
    this.db.prepare(
      `INSERT INTO learning_experiences (
        session_id, state, action, reward, next_state, success, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      feedback.sessionId,
      feedback.state,
      feedback.action,
      feedback.reward,
      feedback.nextState ?? null,
      feedback.success ? 1 : 0,
      feedback.timestamp,
    );

    // Update policy incrementally based on algorithm
    await this.updatePolicyIncremental(session, feedback);

    console.log(`✅ Feedback recorded: session=${feedback.sessionId}, action=${feedback.action}, reward=${feedback.reward}`);
  }

  /**
   * Train policy with batch learning
   */
  async train(
    sessionId: string,
    epochs: number,
    batchSize: number,
    learningRate: number
  ): Promise<TrainingResult> {
    const session = this.activeSessions.get(sessionId) || await this.getSession(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const startTime = Date.now();

    // Get all experiences for this session
    const experiences = this.db.prepare(
      `SELECT * FROM learning_experiences
       WHERE session_id = ?
       ORDER BY timestamp ASC`,
    ).all(sessionId) as any[];

    if (experiences.length === 0) {
      throw new Error(`No training data available for session: ${sessionId}`);
    }

    let totalLoss = 0;
    let totalReward = 0;
    let batchCount = 0;

    // Training loop
    for (let epoch = 0; epoch < epochs; epoch++) {
      // Shuffle experiences
      const shuffled = this.shuffleArray([...experiences]);

      // Process in batches
      for (let i = 0; i < shuffled.length; i += batchSize) {
        const batch = shuffled.slice(i, i + batchSize);

        // Calculate loss and update policy
        const batchLoss = await this.trainBatch(session, batch, learningRate);
        totalLoss += batchLoss;
        batchCount++;

        // Accumulate rewards
        totalReward += batch.reduce((sum, exp) => sum + Number(exp.reward), 0);
      }

      // Log progress
      if ((epoch + 1) % 10 === 0) {
        console.log(`  Epoch ${epoch + 1}/${epochs} - Loss: ${(totalLoss / batchCount).toFixed(4)}`);
      }
    }

    const trainingTimeMs = Date.now() - startTime;
    const avgReward = totalReward / (experiences.length * epochs);
    const finalLoss = totalLoss / batchCount;

    // Save trained policy
    await this.savePolicy(sessionId);

    // Calculate convergence rate
    const convergenceRate = await this.calculateConvergenceRate(sessionId);

    console.log(`✅ Training completed: ${epochs} epochs, ${trainingTimeMs}ms`);

    return {
      epochsCompleted: epochs,
      finalLoss,
      avgReward,
      convergenceRate,
      trainingTimeMs,
    };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Get session from database
   */
  private async getSession(sessionId: string): Promise<LearningSession | null> {
    const row = this.db.prepare(
      `SELECT * FROM learning_sessions WHERE id = ?`,
    ).get(sessionId) as any;

    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      sessionType: row.session_type,
      config: JSON.parse(row.config),
      startTime: Number(row.start_time),
      endTime: row.end_time != null ? Number(row.end_time) : undefined,
      status: row.status,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /**
   * Get or create state embedding
   */
  private async getStateEmbedding(sessionId: string, state: string): Promise<Float32Array> {
    // Check if embedding exists
    const existing = this.db.prepare(
      `SELECT embedding FROM learning_state_embeddings
       WHERE session_id = ? AND state = ?`,
    ).get(sessionId, state) as any;

    if (existing) {
      // SQLite returns BLOB as a Node Buffer; reinterpret bytes as Float32Array.
      const raw = existing.embedding;
      const buf = raw instanceof Buffer ? raw : Buffer.from(raw);
      return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    }

    // Generate new embedding
    const embedding = await this.embedder.embed(state);

    // Store embedding
    this.db.prepare(
      `INSERT INTO learning_state_embeddings (session_id, state, embedding)
       VALUES (?, ?, ?)`,
    ).run(sessionId, state, Buffer.from(embedding.buffer));

    return embedding;
  }

  /**
   * Get latest policy for session
   */
  private async getLatestPolicy(sessionId: string): Promise<any> {
    const policy = this.db.prepare(
      `SELECT * FROM learning_policies
       WHERE session_id = ?
       ORDER BY version DESC
       LIMIT 1`,
    ).get(sessionId) as any;

    if (!policy) {
      // Return empty policy
      return {
        stateActionPairs: {},
        qValues: {},
        visitCounts: {},
        avgRewards: {},
      };
    }

    return {
      stateActionPairs: JSON.parse(policy.state_action_pairs),
      qValues: JSON.parse(policy.q_values),
      visitCounts: JSON.parse(policy.visit_counts),
      avgRewards: JSON.parse(policy.avg_rewards),
    };
  }

  /**
   * Calculate action scores based on algorithm
   */
  private async calculateActionScores(
    session: LearningSession,
    state: string,
    stateEmbedding: Float32Array,
    policy: any
  ): Promise<Array<{ action: string; score: number }>> {
    // Get possible actions from past experiences
    const actions = (this.db.prepare(
      `SELECT DISTINCT action FROM learning_experiences
       WHERE session_id = ?`,
    ).all(session.id) as any[]).map(row => row.action as string);

    if (actions.length === 0) {
      // Default actions if none exist
      return [
        { action: 'action_1', score: 0.5 },
        { action: 'action_2', score: 0.4 },
        { action: 'action_3', score: 0.3 },
      ];
    }

    // Calculate scores based on algorithm type
    const scores: Array<{ action: string; score: number }> = [];

    for (const action of actions) {
      const key = `${state}|${action}`;
      let score = 0;

      switch (session.sessionType) {
        case 'q-learning':
        case 'sarsa':
        case 'dqn':
          // Use Q-value from policy
          score = policy.qValues[key] || 0;
          break;

        case 'policy-gradient':
        case 'actor-critic':
        case 'ppo':
          // Use average reward
          score = policy.avgRewards[key] || 0;
          break;

        case 'decision-transformer':
          // Use reward-conditioned probability
          score = this.calculateTransformerScore(state, action, policy);
          break;

        case 'mcts':
          // Use UCB1 formula
          score = this.calculateUCB1(state, action, policy);
          break;

        case 'model-based':
          // Use model prediction
          score = this.calculateModelScore(state, action, policy);
          break;

        default:
          score = Math.random();
      }

      scores.push({ action, score });
    }

    return scores;
  }

  /**
   * Update policy incrementally after feedback
   */
  private async updatePolicyIncremental(session: LearningSession, feedback: ActionFeedback): Promise<void> {
    const policy = await this.getLatestPolicy(feedback.sessionId);
    const key = `${feedback.state}|${feedback.action}`;

    // Initialize if not exists
    if (!policy.qValues[key]) {
      policy.qValues[key] = 0;
      policy.visitCounts[key] = 0;
      policy.avgRewards[key] = 0;
    }

    const alpha = session.config.learningRate;
    const gamma = session.config.discountFactor;

    switch (session.sessionType) {
      case 'q-learning': {
        // Q(s,a) ← Q(s,a) + α[r + γ max Q(s',a') - Q(s,a)]
        let maxNextQ = 0;
        if (feedback.nextState) {
          const nextActions = Object.keys(policy.qValues).filter(k => k.startsWith(feedback.nextState + '|'));
          maxNextQ = Math.max(...nextActions.map(k => policy.qValues[k]), 0);
        }
        const target = feedback.reward + gamma * maxNextQ;
        policy.qValues[key] += alpha * (target - policy.qValues[key]);
        break;
      }

      case 'sarsa': {
        // SARSA: Q(s,a) ← Q(s,a) + α[r + γ Q(s',a') - Q(s,a)]
        // For incremental update, we approximate with current Q-value
        const target = feedback.reward + gamma * (policy.qValues[key] || 0);
        policy.qValues[key] += alpha * (target - policy.qValues[key]);
        break;
      }

      case 'policy-gradient':
      case 'actor-critic':
      case 'ppo': {
        // Update average reward
        policy.visitCounts[key]++;
        const n = policy.visitCounts[key];
        policy.avgRewards[key] += (feedback.reward - policy.avgRewards[key]) / n;
        break;
      }

      default:
        // Default: simple average
        policy.visitCounts[key]++;
        const n = policy.visitCounts[key];
        policy.avgRewards[key] += (feedback.reward - policy.avgRewards[key]) / n;
    }
  }

  /**
   * Train batch of experiences
   */
  private async trainBatch(
    session: LearningSession,
    batch: any[],
    learningRate: number
  ): Promise<number> {
    let totalLoss = 0;
    const policy = await this.getLatestPolicy(session.id);

    for (const exp of batch) {
      const key = `${exp.state}|${exp.action}`;

      // Initialize if needed
      if (!policy.qValues[key]) {
        policy.qValues[key] = 0;
      }

      // Calculate target based on algorithm
      let target = Number(exp.reward);

      if (exp.next_state && session.sessionType !== 'policy-gradient') {
        const nextActions = Object.keys(policy.qValues).filter(k => k.startsWith(exp.next_state + '|'));
        const maxNextQ = Math.max(...nextActions.map(k => policy.qValues[k]), 0);
        target += session.config.discountFactor * maxNextQ;
      }

      // Calculate loss (TD error)
      const prediction = policy.qValues[key];
      const loss = Math.pow(target - prediction, 2);
      totalLoss += loss;

      // Update Q-value
      policy.qValues[key] += learningRate * (target - prediction);

      // Update counts
      policy.visitCounts[key] = (policy.visitCounts[key] || 0) + 1;
    }

    return totalLoss / batch.length;
  }

  /**
   * Save policy to database
   */
  private async savePolicy(sessionId: string): Promise<void> {
    const policy = await this.getLatestPolicy(sessionId);

    const currentVersion = this.db.prepare(
      `SELECT MAX(version) as max_version FROM learning_policies
       WHERE session_id = ?`,
    ).get(sessionId) as any;
    const version = (currentVersion?.max_version != null ? Number(currentVersion.max_version) : 0) + 1;

    this.db.prepare(
      `INSERT INTO learning_policies (
        session_id, state_action_pairs, q_values, visit_counts, avg_rewards, version
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      JSON.stringify(policy.stateActionPairs || {}),
      JSON.stringify(policy.qValues || {}),
      JSON.stringify(policy.visitCounts || {}),
      JSON.stringify(policy.avgRewards || {}),
      version,
    );
  }

  /**
   * Calculate convergence rate
   */
  private async calculateConvergenceRate(sessionId: string): Promise<number> {
    // Get policy versions
    const versions = this.db.prepare(
      `SELECT version, q_values FROM learning_policies
       WHERE session_id = ?
       ORDER BY version DESC
       LIMIT 10`,
    ).all(sessionId) as any[];

    if (versions.length < 2) return 0;

    // Calculate rate of change between versions
    let totalChange = 0;
    for (let i = 0; i < versions.length - 1; i++) {
      const qValues1 = JSON.parse(versions[i].q_values);
      const qValues2 = JSON.parse(versions[i + 1].q_values);

      // Calculate mean absolute difference
      const keys = new Set([...Object.keys(qValues1), ...Object.keys(qValues2)]);
      let diff = 0;
      keys.forEach(key => {
        diff += Math.abs((qValues1[key] || 0) - (qValues2[key] || 0));
      });
      totalChange += diff / keys.size;
    }

    // Lower change = higher convergence
    const avgChange = totalChange / (versions.length - 1);
    return Math.max(0, 1 - avgChange);
  }

  // Algorithm-specific scoring methods
  private calculateTransformerScore(state: string, action: string, policy: any): number {
    const key = `${state}|${action}`;
    return policy.avgRewards[key] || 0;
  }

  private calculateUCB1(state: string, action: string, policy: any): number {
    const key = `${state}|${action}`;
    const q = policy.avgRewards[key] || 0;
    const n = policy.visitCounts[key] || 1;
    const N = Object.values(policy.visitCounts).reduce((sum: number, val: any) => sum + val, 0) || 1;
    const exploration = Math.sqrt(2 * Math.log(N) / n);
    return q + exploration;
  }

  private calculateModelScore(state: string, action: string, policy: any): number {
    const key = `${state}|${action}`;
    return policy.avgRewards[key] || 0;
  }

  private shuffleArray<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // ============================================================================
  // Extended Learning System Methods (Tools 6-10)
  // ============================================================================

  /**
   * Get learning performance metrics with time windows and trends
   *
   * SQLite dialect (post-Item-5): JSON access uses `json_extract(metadata,
   * '$.latency_ms')` (JSON1 extension, built into better-sqlite3 ≥8). Date
   * bucket uses `strftime('%Y-%m-%d', timestamp/1000, 'unixepoch')` and the
   * expression is repeated verbatim in GROUP BY for parity with the postgres
   * port (postgres requires it; SQLite is lenient — repeating it makes both
   * dialects valid against the same shape).
   */
  async getMetrics(options: {
    sessionId?: string;
    timeWindowDays?: number;
    includeTrends?: boolean;
    groupBy?: 'task' | 'session' | 'skill';
  }): Promise<any> {
    const { sessionId, timeWindowDays = 7, includeTrends = true, groupBy = 'task' } = options;

    const cutoffTimestamp = Date.now() - (timeWindowDays * 24 * 60 * 60 * 1000);

    // Base query filters — built with positional `?` placeholders
    let whereClause = 'WHERE timestamp >= ?';
    const params: any[] = [cutoffTimestamp];

    if (sessionId) {
      whereClause += ' AND session_id = ?';
      params.push(sessionId);
    }

    // Overall metrics — `metadata` is a JSON-serialized TEXT column; JSON1's
    // json_extract returns TEXT, CAST to REAL for AVG().
    const overallStats = this.db.prepare(
      `SELECT
        COUNT(*) as total_episodes,
        AVG(reward) as avg_reward,
        AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate,
        MIN(reward) as min_reward,
        MAX(reward) as max_reward,
        AVG(CASE WHEN metadata IS NOT NULL THEN CAST(json_extract(metadata, '$.latency_ms') AS REAL) ELSE NULL END) as avg_latency_ms
      FROM learning_experiences
      ${whereClause}`,
    ).get(...params) as any;

    // Group by metrics — task/session aggregations.
    let groupedMetrics: any[] = [];
    if (groupBy === 'task') {
      groupedMetrics = this.db.prepare(
        `SELECT
          state as group_key,
          COUNT(*) as count,
          AVG(reward) as avg_reward,
          AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate
        FROM learning_experiences
        ${whereClause}
        GROUP BY state
        ORDER BY count DESC
        LIMIT 20`,
      ).all(...params) as any[];
    } else if (groupBy === 'session') {
      groupedMetrics = this.db.prepare(
        `SELECT
          session_id as group_key,
          COUNT(*) as count,
          AVG(reward) as avg_reward,
          AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate
        FROM learning_experiences
        ${whereClause}
        GROUP BY session_id
        ORDER BY count DESC
        LIMIT 20`,
      ).all(...params) as any[];
    }

    // Trend analysis — date bucket expression repeated verbatim in SELECT
    // and GROUP BY (postgres-parity, always valid in SQLite).
    let trends: any[] = [];
    if (includeTrends) {
      trends = this.db.prepare(
        `SELECT
          strftime('%Y-%m-%d', timestamp/1000, 'unixepoch') as date_bucket,
          COUNT(*) as count,
          AVG(reward) as avg_reward,
          AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate
        FROM learning_experiences
        ${whereClause}
        GROUP BY strftime('%Y-%m-%d', timestamp/1000, 'unixepoch')
        ORDER BY date_bucket ASC`,
      ).all(...params) as any[];
    }

    // Policy improvement metrics
    let policyVersions: any[] = [];
    if (sessionId) {
      policyVersions = this.db.prepare(
        `SELECT
          version,
          created_at,
          q_values
        FROM learning_policies
        WHERE session_id = ?
        ORDER BY version ASC`,
      ).all(sessionId) as any[];
    }

    let policyImprovement = 0;
    if (policyVersions.length >= 2) {
      const firstPolicy = JSON.parse(policyVersions[0].q_values);
      const latestPolicy = JSON.parse(policyVersions[policyVersions.length - 1].q_values);

      const commonKeys = Object.keys(firstPolicy).filter(k => latestPolicy[k] !== undefined);
      if (commonKeys.length > 0) {
        const avgFirst = commonKeys.reduce((sum, k) => sum + firstPolicy[k], 0) / commonKeys.length;
        const avgLatest = commonKeys.reduce((sum, k) => sum + latestPolicy[k], 0) / commonKeys.length;
        policyImprovement = avgLatest - avgFirst;
      }
    }

    return {
      timeWindow: {
        days: timeWindowDays,
        startTimestamp: cutoffTimestamp,
        endTimestamp: Date.now(),
      },
      overall: {
        totalEpisodes: Number(overallStats.total_episodes) || 0,
        avgReward: Number(overallStats.avg_reward) || 0,
        successRate: Number(overallStats.success_rate) || 0,
        minReward: Number(overallStats.min_reward) || 0,
        maxReward: Number(overallStats.max_reward) || 0,
        avgLatencyMs: Number(overallStats.avg_latency_ms) || 0,
      },
      groupedMetrics: groupedMetrics.map(g => ({
        key: g.group_key,
        count: Number(g.count),
        avgReward: Number(g.avg_reward),
        successRate: Number(g.success_rate),
      })),
      trends: trends.map(t => ({
        date: t.date_bucket,
        count: Number(t.count),
        avgReward: Number(t.avg_reward),
        successRate: Number(t.success_rate),
      })),
      policyImprovement: {
        versions: policyVersions.length,
        qValueImprovement: policyImprovement,
      },
    };
  }

  /**
   * Transfer learning between sessions or tasks
   */
  async transferLearning(options: {
    sourceSession?: string;
    targetSession?: string;
    sourceTask?: string;
    targetTask?: string;
    minSimilarity?: number;
    transferType?: 'episodes' | 'skills' | 'causal_edges' | 'all';
    maxTransfers?: number;
  }): Promise<any> {
    const {
      sourceSession,
      targetSession,
      sourceTask,
      targetTask,
      minSimilarity = 0.7,
      transferType = 'all',
      maxTransfers = 10,
    } = options;

    if (!sourceSession && !sourceTask) {
      throw new Error('Must specify either sourceSession or sourceTask');
    }

    if (!targetSession && !targetTask) {
      throw new Error('Must specify either targetSession or targetTask');
    }

    const transferred: any = {
      episodes: 0,
      skills: 0,
      causalEdges: 0,
      details: [],
    };

    // Transfer episodes
    if (transferType === 'episodes' || transferType === 'all') {
      const sourceFilter = sourceSession ? 'session_id = ?' : 'state LIKE ?';
      const sourceArg = sourceSession ?? `%${sourceTask}%`;
      const sourceEpisodes = this.db.prepare(
        `SELECT * FROM learning_experiences
         WHERE ${sourceFilter}
         ORDER BY reward DESC
         LIMIT ?`,
      ).all(sourceArg, maxTransfers) as any[];

      for (const episode of sourceEpisodes) {
        // Check similarity if transferring between tasks
        if (sourceTask && targetTask) {
          const sourceEmbed = await this.embedder.embed(episode.state);
          const targetEmbed = await this.embedder.embed(targetTask);
          const similarity = this.cosineSimilarity(sourceEmbed, targetEmbed);

          if (similarity < minSimilarity) {
            continue;
          }

          transferred.details.push({
            type: 'episode',
            id: episode.id,
            similarity,
          });
        }

        // Insert transferred episode
        this.db.prepare(
          `INSERT INTO learning_experiences (
            session_id, state, action, reward, next_state, success, timestamp, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          targetSession ?? episode.session_id,
          targetTask ?? episode.state,
          episode.action,
          episode.reward,
          episode.next_state,
          episode.success,
          Date.now(),
          JSON.stringify({ transferred_from: episode.id }),
        );

        transferred.episodes++;
      }
    }

    // Transfer policy/Q-values
    if (sourceSession && targetSession && (transferType === 'all' || transferType === 'skills')) {
      const sourcePolicy = await this.getLatestPolicy(sourceSession);
      const targetPolicy = await this.getLatestPolicy(targetSession);

      // Transfer Q-values with similarity weighting
      let transferredQValues = 0;
      for (const [key, qValue] of Object.entries(sourcePolicy.qValues)) {
        const [state, action] = key.split('|');

        // Check if target has similar state
        if (targetTask) {
          const stateEmbed = await this.embedder.embed(state);
          const targetEmbed = await this.embedder.embed(targetTask);
          const similarity = this.cosineSimilarity(stateEmbed, targetEmbed);

          if (similarity >= minSimilarity) {
            const targetKey = `${targetTask}|${action}`;
            targetPolicy.qValues[targetKey] = qValue as number;
            transferredQValues++;
          }
        }
      }

      if (transferredQValues > 0) {
        // Save updated target policy
        const verRow = this.db.prepare(
          `SELECT MAX(version) as max_version FROM learning_policies WHERE session_id = ?`,
        ).get(targetSession) as any;
        const version = (verRow?.max_version != null ? Number(verRow.max_version) : 0);

        this.db.prepare(
          `INSERT INTO learning_policies (
            session_id, state_action_pairs, q_values, visit_counts, avg_rewards, version
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          targetSession,
          JSON.stringify(targetPolicy.stateActionPairs || {}),
          JSON.stringify(targetPolicy.qValues || {}),
          JSON.stringify(targetPolicy.visitCounts || {}),
          JSON.stringify(targetPolicy.avgRewards || {}),
          version + 1,
        );

        transferred.skills = transferredQValues;
      }
    }

    return {
      success: true,
      transferred,
      source: { session: sourceSession, task: sourceTask },
      target: { session: targetSession, task: targetTask },
      minSimilarity,
      transferType,
    };
  }

  /**
   * Explain action recommendations with XAI (Explainable AI)
   */
  async explainAction(options: {
    query: string;
    k?: number;
    explainDepth?: 'summary' | 'detailed' | 'full';
    includeConfidence?: boolean;
    includeEvidence?: boolean;
    includeCausal?: boolean;
  }): Promise<any> {
    const {
      query,
      k = 5,
      explainDepth = 'detailed',
      includeConfidence = true,
      includeEvidence = true,
      includeCausal = true,
    } = options;

    // Get query embedding
    const queryEmbed = await this.embedder.embed(query);

    // Find similar past experiences
    const allExperiences = this.db.prepare(
      `SELECT * FROM learning_experiences
       ORDER BY timestamp DESC
       LIMIT 100`,
    ).all() as any[];

    const rankedExperiences: any[] = [];
    for (const exp of allExperiences) {
      const stateEmbed = await this.getStateEmbedding(exp.session_id, exp.state);
      const similarity = this.cosineSimilarity(queryEmbed, stateEmbed);

      rankedExperiences.push({
        ...exp,
        similarity,
      });
    }

    rankedExperiences.sort((a, b) => b.similarity - a.similarity);
    const topExperiences = rankedExperiences.slice(0, k);

    // Aggregate recommendations
    const actionScores: Record<string, { count: number; avgReward: number; successRate: number; evidence: any[] }> = {};

    for (const exp of topExperiences) {
      if (!actionScores[exp.action]) {
        actionScores[exp.action] = {
          count: 0,
          avgReward: 0,
          successRate: 0,
          evidence: [],
        };
      }

      const score = actionScores[exp.action];
      score.count++;
      score.avgReward += Number(exp.reward);
      score.successRate += exp.success ? 1 : 0;

      if (includeEvidence) {
        score.evidence.push({
          episodeId: exp.id,
          state: exp.state,
          reward: exp.reward,
          success: exp.success,
          similarity: exp.similarity,
          timestamp: exp.timestamp,
        });
      }
    }

    // Calculate final scores
    const recommendations = Object.entries(actionScores).map(([action, data]) => ({
      action,
      confidence: data.count / topExperiences.length,
      avgReward: data.avgReward / data.count,
      successRate: data.successRate / data.count,
      supportingExamples: data.count,
      evidence: includeEvidence ? data.evidence.slice(0, 3) : undefined,
    }));

    recommendations.sort((a, b) => b.confidence - a.confidence);

    // Causal reasoning chains (if enabled). causal_edges is owned by
    // CausalMemoryGraph (separate controller); the table may not exist on a
    // fresh LearningSystem-only test instance — tolerate that with an
    // empty-result fallback. This is not a silent failure: the controller
    // has no authoritative schema ownership of causal_edges, and the query
    // is best-effort context for explainability.
    let causalChains: any[] = [];
    if (includeCausal) {
      try {
        causalChains = this.db.prepare(
          `SELECT * FROM causal_edges
           ORDER BY uplift DESC
           LIMIT 5`,
        ).all() as any[];
      } catch {
        causalChains = [];
      }
    }

    const response: any = {
      query,
      recommendations: recommendations.slice(0, k),
      explainDepth,
    };

    if (explainDepth === 'detailed' || explainDepth === 'full') {
      response.reasoning = {
        similarExperiencesFound: topExperiences.length,
        avgSimilarity: topExperiences.reduce((sum, e) => sum + e.similarity, 0) / topExperiences.length,
        uniqueActions: recommendations.length,
      };
    }

    if (explainDepth === 'full') {
      response.causalChains = causalChains;
      response.allEvidence = topExperiences;
    }

    return response;
  }

  /**
   * Record tool execution as experience for offline learning
   */
  async recordExperience(options: {
    sessionId: string;
    toolName: string;
    action: string;
    stateBefore?: any;
    stateAfter?: any;
    outcome: string;
    reward: number;
    success: boolean;
    latencyMs?: number;
    metadata?: any;
  }): Promise<number> {
    const {
      sessionId,
      toolName,
      action,
      stateBefore,
      stateAfter,
      outcome,
      reward,
      success,
      latencyMs,
      metadata,
    } = options;

    // Construct state representation
    const state = `tool:${toolName}|${action}`;
    const nextState = stateAfter ? JSON.stringify(stateAfter) : null;

    // Store as learning experience. lastInsertRowid replaces postgres'
    // RETURNING id (BIGSERIAL).
    const result = this.db.prepare(
      `INSERT INTO learning_experiences (
        session_id, state, action, reward, next_state, success, timestamp, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      state,
      outcome,
      reward,
      nextState,
      success ? 1 : 0,
      Date.now(),
      JSON.stringify({
        toolName,
        action,
        stateBefore,
        stateAfter,
        latencyMs,
        ...metadata,
      }),
    );

    const insertedId = Number(result.lastInsertRowid);
    console.log(`✅ Experience recorded: tool=${toolName}, reward=${reward}, success=${success}`);
    return insertedId;
  }

  /**
   * Calculate reward signal with shaping based on multiple factors
   *
   * Async because the optional causal-impact adjustment reads from
   * `causal_edges` (owned by CausalMemoryGraph).
   */
  async calculateReward(options: {
    episodeId?: number;
    success: boolean;
    targetAchieved?: boolean;
    efficiencyScore?: number;
    qualityScore?: number;
    timeTakenMs?: number;
    expectedTimeMs?: number;
    includeCausal?: boolean;
    rewardFunction?: 'standard' | 'sparse' | 'dense' | 'shaped';
  }): Promise<number> {
    const {
      episodeId,
      success,
      targetAchieved = true,
      efficiencyScore = 0.5,
      qualityScore = 0.5,
      timeTakenMs,
      expectedTimeMs,
      includeCausal = true,
      rewardFunction = 'standard',
    } = options;

    let reward = 0;

    switch (rewardFunction) {
      case 'sparse':
        // Sparse: Only reward on success
        reward = success && targetAchieved ? 1.0 : 0.0;
        break;

      case 'dense':
        // Dense: Partial rewards for progress
        reward = success ? 1.0 : 0.0;
        reward += targetAchieved ? 0.5 : 0.0;
        reward += qualityScore * 0.3;
        reward += efficiencyScore * 0.2;
        break;

      case 'shaped':
        // Shaped: Reward shaping with time efficiency
        reward = success ? 1.0 : -0.5;
        if (targetAchieved) reward += 0.3;

        // Time efficiency bonus
        if (timeTakenMs && expectedTimeMs) {
          const timeRatio = timeTakenMs / expectedTimeMs;
          const timeBonus = Math.max(0, 1 - timeRatio) * 0.2;
          reward += timeBonus;
        }

        // Quality and efficiency
        reward += (qualityScore - 0.5) * 0.3;
        reward += (efficiencyScore - 0.5) * 0.2;
        break;

      case 'standard':
      default:
        // Standard: Weighted combination
        reward = success ? 0.6 : 0.0;
        reward += targetAchieved ? 0.2 : 0.0;
        reward += qualityScore * 0.1;
        reward += efficiencyScore * 0.1;
        break;
    }

    // Causal impact adjustment. causal_edges is owned by CausalMemoryGraph
    // (separate controller); tolerate its absence in test-only contexts.
    if (includeCausal && episodeId) {
      try {
        const causalEdges = this.db.prepare(
          `SELECT AVG(uplift) as avg_uplift
           FROM causal_edges
           WHERE from_memory_id = ? OR to_memory_id = ?`,
        ).get(episodeId, episodeId) as any;
        if (causalEdges?.avg_uplift != null) {
          reward += Number(causalEdges.avg_uplift) * 0.1; // 10% weight for causal impact
        }
      } catch {
        // Table not present in this test context; skip the causal adjustment.
      }
    }

    // Normalize to [0, 1] range
    return Math.max(0, Math.min(1, reward));
  }

  // Helper method for cosine similarity
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
