/**
 * SkillLibrary - Lifelong Learning Skill Management
 *
 * Promotes high-reward trajectories into reusable skills.
 * Manages skill composition, relationships, and adaptive selection.
 *
 * Based on: "Voyager: An Open-Ended Embodied Agent with Large Language Models"
 * https://arxiv.org/abs/2305.16291
 *
 * ADR-0170 Phase B.3 — ported from SQLite to PostgreSQL dialect.
 * - SQLite path dead-stripped (better-sqlite3/sql.js).
 * - skill_vec Option F mirror writes dead-stripped (Phase C uses pgvector).
 * - @ruvector/graph-node Cypher branches dead-stripped (per resolution-J).
 */

import { EmbeddingService } from './EmbeddingService.js';
import { VectorBackend } from '../backends/VectorBackend.js';
import { PostgresBackend } from '../backends/postgres/PostgresBackend.js';
import { cosineSimilarity } from '../utils/vector-math.js';
import { QueryCache, type QueryCacheConfig } from '../core/QueryCache.js';

export interface Skill {
  id?: number;
  name: string;
  description?: string;
  signature?: {
    // v1 API: optional
    inputs: Record<string, any>;
    outputs: Record<string, any>;
  };
  code?: string;
  successRate: number;
  uses?: number; // v1 API: optional (defaults to 0)
  avgReward?: number; // v1 API: optional (defaults to 0)
  avgLatencyMs?: number; // v1 API: optional (defaults to 0)
  createdFromEpisode?: number;
  metadata?: Record<string, any>;
}

export interface SkillLink {
  parentSkillId: number;
  childSkillId: number;
  relationship: 'prerequisite' | 'alternative' | 'refinement' | 'composition';
  weight: number;
  metadata?: Record<string, any>;
}

export interface SkillQuery {
  /** v2 API: task description */
  task?: string;
  /** v1 API: query string (alias for task) */
  query?: string;
  k?: number;
  minSuccessRate?: number;
  preferRecent?: boolean;
}

// ADR-0076 A4: Dual-instance guard — prevent duplicate construction
// when both ControllerRegistry and AgentDBService create this controller
let _singleton: InstanceType<typeof SkillLibrary> | null = null;

export class SkillLibrary {
  private db: PostgresBackend;
  private embedder: EmbeddingService;
  private vectorBackend: VectorBackend | null;
  private queryCache: QueryCache;
  private schemaReady: Promise<void>;

  static _resetSingleton(): void { _singleton = null; }

  constructor(
    db: PostgresBackend,
    embedder: EmbeddingService,
    vectorBackend?: VectorBackend,
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
    this.vectorBackend = vectorBackend || null;
    this.queryCache = new QueryCache(cacheConfig);
    // ADR-0170 Phase B.3: schema initialization is async — kick it off
    // immediately, await it on the first DB-touching call.
    this.schemaReady = this.initializeSchema();
  }

  /**
   * Initialize skills / skill_links / skill_embeddings tables.
   *
   * Mirrors `src/schemas/schema.sql:67-111` (PostgreSQL dialect) so a
   * freshly-constructed SkillLibrary can immediately accept `createSkill()`
   * without requiring an external migration step.
   *
   * ADR-0090 B5 (2026-04-15): previously this schema only existed in the
   * standalone mcp-server path; the mirror preserves the
   * "controller constructs its own tables" invariant.
   */
  private async initializeSchema(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id BIGSERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        signature JSONB NOT NULL,
        code TEXT,
        success_rate REAL DEFAULT 0.0,
        uses BIGINT DEFAULT 0,
        avg_reward REAL DEFAULT 0.0,
        avg_latency_ms BIGINT DEFAULT 0,
        created_from_episode BIGINT,
        created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        last_used_at BIGINT,
        metadata JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_skills_success ON skills(success_rate DESC);
      CREATE INDEX IF NOT EXISTS idx_skills_uses ON skills(uses DESC);
      CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);

      CREATE TABLE IF NOT EXISTS skill_links (
        id BIGSERIAL PRIMARY KEY,
        parent_skill_id BIGINT NOT NULL,
        child_skill_id BIGINT NOT NULL,
        relationship TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        metadata JSONB,
        FOREIGN KEY(parent_skill_id) REFERENCES skills(id) ON DELETE CASCADE,
        FOREIGN KEY(child_skill_id) REFERENCES skills(id) ON DELETE CASCADE,
        UNIQUE(parent_skill_id, child_skill_id, relationship)
      );

      CREATE INDEX IF NOT EXISTS idx_skill_links_parent ON skill_links(parent_skill_id);
      CREATE INDEX IF NOT EXISTS idx_skill_links_child ON skill_links(child_skill_id);

      CREATE TABLE IF NOT EXISTS skill_embeddings (
        skill_id BIGINT PRIMARY KEY,
        embedding BYTEA NOT NULL,
        embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',
        FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
      );
    `);
  }

  /**
   * Create a new skill manually or from an episode
   * Invalidates skill cache
   */
  async createSkill(skill: Skill): Promise<number> {
    await this.schemaReady;
    // Invalidate skills cache on write
    this.queryCache.invalidateCategory('skills');

    // v1 API compatibility: provide defaults for optional fields.
    // `uses` and `avg_latency_ms` are BIGINT columns; coerce to integer
    // (postgres rejects floats for BIGINT, where SQLite silently
    // truncated). Math.round preserves the SQLite-era rounding behavior
    // for callers that previously passed `Math.random() * 200`-style
    // floats.
    const signature = skill.signature || { inputs: {}, outputs: {} };
    const uses = Math.round(skill.uses ?? 0);
    const avgReward = skill.avgReward ?? 0;
    const avgLatencyMs = Math.round(skill.avgLatencyMs ?? 0);

    const result = await this.db.query(
      `INSERT INTO skills (
        name, description, signature, code, success_rate, uses,
        avg_reward, avg_latency_ms, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        skill.name,
        skill.description ?? null,
        JSON.stringify(signature),
        skill.code ?? null,
        skill.successRate,
        uses,
        avgReward,
        avgLatencyMs,
        skill.metadata ? JSON.stringify(skill.metadata) : null,
      ]
    );

    const skillId = Number((result.rows[0] as any).id);

    // Generate and store embedding
    const text = this.buildSkillText(skill);
    const embedding = await this.embedder.embed(text);

    // ADR-0094 Phase 13.2 fix: ALWAYS persist embedding to skill_embeddings,
    // regardless of whether a vectorBackend is wired. The relational table is
    // the cross-process truth store; vectorBackend is an in-memory accelerator.
    await this.storeSkillEmbedding(skillId, embedding);

    // Also populate the in-memory vectorBackend accelerator if available
    if (this.vectorBackend) {
      try {
        this.vectorBackend.insert(
          `skill:${skillId}`,
          embedding,
          {
            name: skill.name,
            description: skill.description,
            successRate: skill.successRate,
            avgReward: skill.avgReward
          }
        );
      } catch {
        // vectorBackend insert failed — skill_embeddings already has it, so
        // retrieveSkillsLegacy will still find this skill on search.
      }
    }

    return skillId;
  }

  /**
   * Update skill statistics after use
   * Invalidates skill cache
   */
  async updateSkillStats(skillId: number, success: boolean, reward: number, latencyMs: number): Promise<void> {
    await this.schemaReady;
    // Invalidate skills cache on update
    this.queryCache.invalidateCategory('skills');
    // avg_latency_ms is BIGINT; ROUND() returns NUMERIC under postgres so
    // cast back to BIGINT for the column. success_rate / avg_reward are
    // REAL and accept the running-average float result directly.
    await this.db.query(
      `UPDATE skills
       SET
         uses = uses + 1,
         success_rate = (success_rate * uses + $1) / (uses + 1),
         avg_reward = (avg_reward * uses + $2) / (uses + 1),
         avg_latency_ms = ROUND((avg_latency_ms * uses + $3) / (uses + 1))::BIGINT
       WHERE id = $4`,
      [success ? 1 : 0, reward, Math.round(latencyMs), skillId]
    );
  }

  /**
   * Retrieve skills relevant to a task
   */
  async searchSkills(query: SkillQuery): Promise<Skill[]> {
    return this.retrieveSkills(query);
  }

  async retrieveSkills(query: SkillQuery): Promise<Skill[]> {
    await this.schemaReady;
    // v1 API compatibility: accept both 'query' and 'task'
    const task = query.task || query.query;
    if (!task) {
      throw new Error('SkillQuery must provide either task (v2) or query (v1)');
    }

    const { k = 5, minSuccessRate = 0.5, preferRecent = true } = query;

    // Check cache first
    const cacheKey = this.queryCache.generateKey(
      'retrieveSkills',
      [task, k, minSuccessRate, preferRecent],
      'skills'
    );

    const cached = this.queryCache.get<Skill[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Generate query embedding
    const queryEmbedding = await this.embedder.embed(task);

    // Use VectorBackend for semantic search (if available)
    if (this.vectorBackend) {
      try {
        const searchResults = this.vectorBackend.search(queryEmbedding, k * 3);

        // ADR-0094 Phase 13.2 fix: when the vectorBackend is empty (e.g.
        // fresh process, only postgres is persisted), fall through to the
        // SQL-based retrieveSkillsLegacy instead of returning []. ADR-0082
        // forbids silent-empty returns when a fallback path exists.
        if (!searchResults || searchResults.length === 0) {
          return this.retrieveSkillsLegacy(query);
        }

        // Map results back to skill IDs and fetch full skill data
        const skillsWithSimilarity: (Skill & { similarity: number })[] = [];

        for (const result of searchResults) {
          // Extract skill ID from vector ID (format: "skill:123")
          const skillId = parseInt(result.id.replace('skill:', ''));

          // Fetch full skill data from database
          const rowResult = await this.db.query(
            'SELECT * FROM skills WHERE id = $1',
            [skillId]
          );
          const row = rowResult.rows[0] as any;

          if (!row) continue;

          // Apply filters
          if (row.success_rate < minSuccessRate) continue;

          skillsWithSimilarity.push({
            id: Number(row.id),
            name: row.name,
            description: row.description,
            signature: this.parseJSON(row.signature),
            code: row.code,
            successRate: row.success_rate,
            uses: Number(row.uses),
            avgReward: row.avg_reward,
            avgLatencyMs: Number(row.avg_latency_ms),
            createdFromEpisode: row.created_from_episode != null ? Number(row.created_from_episode) : undefined,
            metadata: row.metadata ? this.parseJSON(row.metadata) : undefined,
            similarity: result.similarity
          });
        }

        // ADR-0094 Phase 13.2 fix: vectorBackend returned candidates but
        // none survived the SQL join (e.g. vectorBackend state is stale
        // — ids in the in-memory index don't match rows in skills table).
        // Fall through to SQL similarity search rather than return empty.
        if (skillsWithSimilarity.length === 0) {
          return this.retrieveSkillsLegacy(query);
        }

        // Compute composite scores
        skillsWithSimilarity.sort((a, b) => {
          const scoreA = this.computeSkillScore(a);
          const scoreB = this.computeSkillScore(b);
          return scoreB - scoreA;
        });

        return skillsWithSimilarity.slice(0, k);
      } catch { /* vectorBackend search failed — fall through to SQL */ }
    }

    // Legacy: use SQL-based similarity search
    return this.retrieveSkillsLegacy(query);
  }

  /**
   * Legacy SQL-based skill retrieval (fallback when VectorBackend not available)
   */
  private async retrieveSkillsLegacy(query: SkillQuery): Promise<Skill[]> {
    // v1 API compatibility: accept both 'query' and 'task'
    const task = query.task || query.query;
    if (!task) {
      throw new Error('SkillQuery must provide either task (v2) or query (v1)');
    }

    const { k = 5, minSuccessRate = 0.5 } = query;
    const queryEmbedding = await this.embedder.embed(task);

    // Fetch all skills with embeddings
    const result = await this.db.query(
      `SELECT s.*, e.embedding
       FROM skills s
       LEFT JOIN skill_embeddings e ON s.id = e.skill_id
       WHERE s.success_rate >= $1`,
      [minSuccessRate]
    );
    const rows = result.rows as any[];

    // Compute similarities
    const skillsWithSimilarity: (Skill & { similarity: number })[] = [];
    // ADR-0094 Phase 13.2 fix: pre-embedded legacy fixtures (and skills
    // created before the embedding write-through fix shipped) have rows
    // in `skills` but no corresponding `skill_embeddings` row. Previously
    // we silently skipped them which returned [] for every query against
    // such a fixture — an ADR-0082 silent-empty violation. Instead, when
    // the embedding is missing, fall back to a substring match on
    // name/description/code so the skill is still retrievable.
    const taskLower = task.toLowerCase();
    for (const row of rows) {
      if (!row.embedding) {
        // No embedding — use text-match similarity as a proxy
        const haystack = [row.name, row.description ?? '', row.code ?? '']
          .join('\n')
          .toLowerCase();
        const textMatch = haystack.includes(taskLower);
        if (!textMatch) continue;
        skillsWithSimilarity.push({
          id: Number(row.id),
          name: row.name,
          description: row.description ?? undefined,
          signature: this.parseJSON(row.signature),
          code: row.code ?? undefined,
          successRate: row.success_rate,
          uses: Number(row.uses),
          avgReward: row.avg_reward,
          avgLatencyMs: Number(row.avg_latency_ms),
          createdFromEpisode: row.created_from_episode != null ? Number(row.created_from_episode) : undefined,
          metadata: row.metadata ? this.parseJSON(row.metadata) : undefined,
          // Conservative similarity score: lower than a real vector match
          // but above zero so the result is ranked and returned.
          similarity: 0.5,
        });
        continue;
      }

      const buf = Buffer.isBuffer(row.embedding)
        ? row.embedding
        : Buffer.from(row.embedding as Uint8Array);
      const embedding = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      const similarity = cosineSimilarity(queryEmbedding, embedding);

      skillsWithSimilarity.push({
        id: Number(row.id),
        name: row.name,
        description: row.description ?? undefined,
        signature: this.parseJSON(row.signature),
        code: row.code ?? undefined,
        successRate: row.success_rate,
        uses: Number(row.uses),
        avgReward: row.avg_reward,
        avgLatencyMs: Number(row.avg_latency_ms),
        createdFromEpisode: row.created_from_episode != null ? Number(row.created_from_episode) : undefined,
        metadata: row.metadata ? this.parseJSON(row.metadata) : undefined,
        similarity,
      });
    }

    // Sort by composite score
    skillsWithSimilarity.sort((a, b) => {
      const scoreA = this.computeSkillScore(a);
      const scoreB = this.computeSkillScore(b);
      return scoreB - scoreA;
    });

    return skillsWithSimilarity.slice(0, k);
  }

  /**
   * Store skill embedding via UPSERT (legacy fallback)
   */
  private async storeSkillEmbedding(skillId: number, embedding: Float32Array): Promise<void> {
    const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    await this.db.query(
      `INSERT INTO skill_embeddings (skill_id, embedding)
       VALUES ($1, $2)
       ON CONFLICT(skill_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
      [skillId, buffer]
    );
  }

  /**
   * Link two skills with a relationship
   */
  async linkSkills(link: SkillLink): Promise<void> {
    await this.schemaReady;
    await this.db.query(
      `INSERT INTO skill_links (parent_skill_id, child_skill_id, relationship, weight, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(parent_skill_id, child_skill_id, relationship)
       DO UPDATE SET weight = EXCLUDED.weight`,
      [
        link.parentSkillId,
        link.childSkillId,
        link.relationship,
        link.weight,
        link.metadata ? JSON.stringify(link.metadata) : null,
      ]
    );
  }

  /**
   * Get skill composition plan (prerequisites and alternatives)
   */
  async getSkillPlan(skillId: number): Promise<{
    skill: Skill;
    prerequisites: Skill[];
    alternatives: Skill[];
    refinements: Skill[];
  }> {
    await this.schemaReady;
    // Get main skill
    const skill = await this.getSkillById(skillId);

    // Get prerequisites
    const prereqResult = await this.db.query(
      `SELECT s.* FROM skills s
       JOIN skill_links sl ON s.id = sl.child_skill_id
       WHERE sl.parent_skill_id = $1 AND sl.relationship = 'prerequisite'
       ORDER BY sl.weight DESC`,
      [skillId]
    );
    const prerequisites = (prereqResult.rows as any[]).map((r) => this.rowToSkill(r));

    // Get alternatives
    const altResult = await this.db.query(
      `SELECT s.* FROM skills s
       JOIN skill_links sl ON s.id = sl.child_skill_id
       WHERE sl.parent_skill_id = $1 AND sl.relationship = 'alternative'
       ORDER BY sl.weight DESC, s.success_rate DESC`,
      [skillId]
    );
    const alternatives = (altResult.rows as any[]).map((r) => this.rowToSkill(r));

    // Get refinements
    const refResult = await this.db.query(
      `SELECT s.* FROM skills s
       JOIN skill_links sl ON s.id = sl.child_skill_id
       WHERE sl.parent_skill_id = $1 AND sl.relationship = 'refinement'
       ORDER BY sl.weight DESC, s.created_at DESC`,
      [skillId]
    );
    const refinements = (refResult.rows as any[]).map((r) => this.rowToSkill(r));

    return { skill, prerequisites, alternatives, refinements };
  }

  /**
   * Consolidate high-reward episodes into skills with ML pattern extraction
   * This is the core learning mechanism enhanced with pattern analysis
   */
  async consolidateEpisodesIntoSkills(config: {
    minAttempts?: number;
    minReward?: number;
    timeWindowDays?: number;
    extractPatterns?: boolean;
  }): Promise<{
    created: number;
    updated: number;
    patterns: Array<{
      task: string;
      commonPatterns: string[];
      successIndicators: string[];
      avgReward: number;
    }>;
  }> {
    await this.schemaReady;
    const { minAttempts = 3, minReward = 0.7, timeWindowDays = 7, extractPatterns = true } = config;

    const candidatesResult = await this.db.query(
      `SELECT
         task,
         COUNT(*) as attempt_count,
         AVG(reward) as avg_reward,
         AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END) as success_rate,
         AVG(latency_ms) as avg_latency,
         MAX(id) as latest_episode_id,
         STRING_AGG(id::TEXT, ',') as episode_ids
       FROM episodes
       WHERE ts > EXTRACT(EPOCH FROM NOW())::BIGINT - $1
         AND reward >= $2
       GROUP BY task
       HAVING COUNT(*) >= $3`,
      [timeWindowDays * 86400, minReward, minAttempts]
    );

    const candidates = candidatesResult.rows as Array<{
      task: string;
      attempt_count: string | number;
      avg_reward: number;
      success_rate: number;
      avg_latency: number | null;
      latest_episode_id: string | number;
      episode_ids: string;
    }>;
    let created = 0;
    let updated = 0;
    const patterns: Array<{
      task: string;
      commonPatterns: string[];
      successIndicators: string[];
      avgReward: number;
    }> = [];

    for (const candidate of candidates) {
      try {
        const episodeIds = candidate.episode_ids.split(',').map(Number);
        const attemptCount = Number(candidate.attempt_count);
        const latestEpisodeId = Number(candidate.latest_episode_id);

        // Extract patterns from successful episodes if requested
        let extractedPatterns: string[] = [];
        let successIndicators: string[] = [];
        let enhancedDescription = `Auto-generated skill from successful episodes`;

        if (extractPatterns) {
          const patternData = await this.extractPatternsFromEpisodes(episodeIds);
          extractedPatterns = patternData.commonPatterns;
          successIndicators = patternData.successIndicators;

          if (extractedPatterns.length > 0) {
            enhancedDescription = `Skill learned from ${episodeIds.length} successful episodes. Common patterns: ${extractedPatterns.slice(0, 3).join(', ')}`;
          }

          patterns.push({
            task: candidate.task,
            commonPatterns: extractedPatterns,
            successIndicators: successIndicators,
            avgReward: candidate.avg_reward,
          });
        }

        // Check if skill already exists
        const existingResult = await this.db.query(
          'SELECT id FROM skills WHERE name = $1',
          [candidate.task]
        );
        const existing = existingResult.rows[0] as any;

        if (!existing) {
          // Create new skill with extracted patterns
          const skill: Skill = {
            name: candidate.task,
            description: enhancedDescription,
            signature: {
              inputs: { task: 'string' },
              outputs: { result: 'any' },
            },
            successRate: candidate.success_rate,
            uses: attemptCount,
            avgReward: candidate.avg_reward,
            avgLatencyMs: candidate.avg_latency ?? 0,
            createdFromEpisode: latestEpisodeId,
            metadata: {
              sourceEpisodes: episodeIds,
              autoGenerated: true,
              consolidatedAt: Date.now(),
              extractedPatterns: extractedPatterns,
              successIndicators: successIndicators,
              patternConfidence: this.calculatePatternConfidence(
                episodeIds.length,
                candidate.success_rate
              ),
            },
          };

          await this.createSkill(skill);
          created++;
        } else {
          // Update existing skill stats
          await this.updateSkillStats(
            Number(existing.id),
            candidate.success_rate > 0.5,
            candidate.avg_reward,
            candidate.avg_latency ?? 0
          );
          updated++;
        }
      } catch (error) {
        // Per-candidate error isolation — one bad candidate doesn't abort the rest
        console.warn(`[SkillLibrary] Failed to consolidate candidate '${candidate.task}':`, error);
      }
    }

    return { created, updated, patterns };
  }

  /**
   * Extract common patterns from successful episodes using ML-inspired analysis
   */
  private async extractPatternsFromEpisodes(episodeIds: number[]): Promise<{
    commonPatterns: string[];
    successIndicators: string[];
  }> {
    if (episodeIds.length === 0) {
      return { commonPatterns: [], successIndicators: [] };
    }

    // Build $1, $2, … placeholder list for IN clause
    const placeholders = episodeIds.map((_, i) => `$${i + 1}`).join(',');
    const episodesResult = await this.db.query(
      `SELECT id, task, input, output, critique, reward, success, metadata
       FROM episodes
       WHERE id IN (${placeholders})
       AND success = TRUE`,
      episodeIds
    );
    const episodes = episodesResult.rows as any[];

    if (episodes.length === 0) {
      return { commonPatterns: [], successIndicators: [] };
    }

    const commonPatterns: string[] = [];
    const successIndicators: string[] = [];

    // Pattern 1: Analyze output text for common keywords and phrases
    const outputTexts = episodes.map((ep) => ep.output).filter(Boolean);

    if (outputTexts.length > 0) {
      const keywordFrequency = this.extractKeywordFrequency(outputTexts);
      const topKeywords = this.getTopKeywords(keywordFrequency, 5);

      if (topKeywords.length > 0) {
        commonPatterns.push(`Common techniques: ${topKeywords.join(', ')}`);
      }
    }

    // Pattern 2: Analyze critique patterns for successful strategies
    const critiques = episodes.map((ep) => ep.critique).filter(Boolean);

    if (critiques.length > 0) {
      const critiqueKeywords = this.extractKeywordFrequency(critiques);
      const topCritiquePatterns = this.getTopKeywords(critiqueKeywords, 3);

      if (topCritiquePatterns.length > 0) {
        successIndicators.push(...topCritiquePatterns);
      }
    }

    // Pattern 3: Analyze reward distribution
    const avgReward = episodes.reduce((sum, ep) => sum + ep.reward, 0) / episodes.length;
    const highRewardCount = episodes.filter((ep) => ep.reward > avgReward).length;
    const highRewardRatio = highRewardCount / episodes.length;

    if (highRewardRatio > 0.6) {
      successIndicators.push(
        `High consistency (${(highRewardRatio * 100).toFixed(0)}% above average)`
      );
    }

    // Pattern 4: Analyze metadata for common parameters
    const metadataPatterns = this.extractMetadataPatterns(episodes);
    if (metadataPatterns.length > 0) {
      commonPatterns.push(...metadataPatterns);
    }

    // Pattern 5: Temporal analysis - learning curve
    const learningTrend = this.analyzeLearningTrend(episodes);
    if (learningTrend) {
      successIndicators.push(learningTrend);
    }

    return { commonPatterns, successIndicators };
  }

  /**
   * Extract keyword frequency from text array using NLP-inspired techniques
   */
  private extractKeywordFrequency(texts: string[]): Map<string, number> {
    const frequency = new Map<string, number>();

    // Common stop words to filter out
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'from',
      'as',
      'is',
      'was',
      'are',
      'were',
      'been',
      'be',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'should',
      'could',
      'may',
      'might',
      'must',
      'can',
      'this',
      'that',
      'these',
      'those',
    ]);

    for (const text of texts) {
      // Extract words (alphanumeric sequences)
      const words = text.toLowerCase().match(/\b[a-z0-9_-]+\b/g) || [];

      for (const word of words) {
        if (word.length > 3 && !stopWords.has(word)) {
          frequency.set(word, (frequency.get(word) || 0) + 1);
        }
      }
    }

    return frequency;
  }

  /**
   * Get top N keywords by frequency
   */
  private getTopKeywords(frequency: Map<string, number>, n: number): string[] {
    return Array.from(frequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .filter(([_, count]) => count >= 2) // Only keywords appearing at least twice
      .map(([word, _]) => word);
  }

  /**
   * Extract common patterns from episode metadata
   */
  private extractMetadataPatterns(episodes: any[]): string[] {
    const patterns: string[] = [];
    const metadataFields = new Map<string, Set<any>>();

    for (const episode of episodes) {
      if (episode.metadata) {
        try {
          const metadata =
            typeof episode.metadata === 'string' ? JSON.parse(episode.metadata) : episode.metadata;

          for (const [key, value] of Object.entries(metadata)) {
            if (!metadataFields.has(key)) {
              metadataFields.set(key, new Set());
            }
            metadataFields.get(key)!.add(value);
          }
        } catch (e) {
          // Skip invalid metadata
        }
      }
    }

    // Find fields with consistent values
    metadataFields.forEach((values, field) => {
      if (values.size === 1) {
        // All episodes have the same value for this field
        const value = Array.from(values)[0];
        patterns.push(`Consistent ${field}: ${value}`);
      }
    });

    return patterns;
  }

  /**
   * Analyze learning trend across episodes
   */
  private analyzeLearningTrend(episodes: any[]): string | null {
    if (episodes.length < 3) return null;

    // Sort by episode ID (temporal order)
    const sorted = [...episodes].sort((a, b) => Number(a.id) - Number(b.id));

    const firstHalfReward =
      sorted.slice(0, Math.floor(sorted.length / 2)).reduce((sum, ep) => sum + ep.reward, 0) /
      Math.floor(sorted.length / 2);

    const secondHalfReward =
      sorted.slice(Math.floor(sorted.length / 2)).reduce((sum, ep) => sum + ep.reward, 0) /
      (sorted.length - Math.floor(sorted.length / 2));

    const improvement = ((secondHalfReward - firstHalfReward) / firstHalfReward) * 100;

    if (improvement > 10) {
      return `Strong learning curve (+${improvement.toFixed(0)}% improvement)`;
    } else if (improvement > 5) {
      return `Moderate learning curve (+${improvement.toFixed(0)}% improvement)`;
    } else if (Math.abs(improvement) < 5) {
      return `Stable performance (±${Math.abs(improvement).toFixed(0)}%)`;
    }

    return null;
  }

  /**
   * Calculate pattern confidence score based on sample size and success rate
   */
  private calculatePatternConfidence(sampleSize: number, successRate: number): number {
    // Confidence increases with sample size and success rate
    // Using a sigmoid-like function for smooth scaling
    const sampleFactor = Math.min(sampleSize / 10, 1.0); // Saturates at 10 samples
    const successFactor = successRate;

    return Math.min(sampleFactor * successFactor, 0.99);
  }

  /**
   * Prune underperforming skills
   * Invalidates cache on completion
   */
  async pruneSkills(config: { minUses?: number; minSuccessRate?: number; maxAgeDays?: number }): Promise<number> {
    await this.schemaReady;
    const { minUses = 3, minSuccessRate = 0.4, maxAgeDays = 60 } = config;

    const result = await this.db.query(
      `DELETE FROM skills
       WHERE uses < $1
         AND success_rate < $2
         AND created_at < EXTRACT(EPOCH FROM NOW())::BIGINT - $3`,
      [minUses, minSuccessRate, maxAgeDays * 86400]
    );

    const changes = (result as any).rowCount ?? 0;

    // Invalidate cache after pruning
    if (changes > 0) {
      this.queryCache.invalidateCategory('skills');
    }

    return changes;
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
   * Warm cache with common skill queries
   */
  async warmCache(commonTasks: string[]): Promise<void> {
    await this.queryCache.warm(async (cache) => {
      // Pre-load common skill queries
      for (const task of commonTasks) {
        await this.retrieveSkills({ task, k: 5 });
      }
    });
  }

  // ========================================================================
  // Private Helper Methods
  // ========================================================================

  private async getSkillById(id: number): Promise<Skill> {
    const result = await this.db.query('SELECT * FROM skills WHERE id = $1', [id]);
    const row = result.rows[0] as any;
    if (!row) throw new Error(`Skill ${id} not found`);
    return this.rowToSkill(row);
  }

  private rowToSkill(row: any): Skill {
    return {
      id: Number(row.id),
      name: row.name,
      description: row.description,
      signature: this.parseJSON(row.signature),
      code: row.code,
      successRate: row.success_rate,
      uses: Number(row.uses),
      avgReward: row.avg_reward,
      avgLatencyMs: Number(row.avg_latency_ms),
      createdFromEpisode: row.created_from_episode != null ? Number(row.created_from_episode) : undefined,
      metadata: row.metadata ? this.parseJSON(row.metadata) : undefined,
    };
  }

  /**
   * Parse JSONB values. PostgreSQL drivers may hand back either a parsed
   * object (pg JSONB) or a string (pglite uses JSON encoding for some paths).
   */
  private parseJSON(value: any): any {
    if (value == null) return value;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }

  private buildSkillText(skill: Skill): string {
    const parts = [skill.name];
    if (skill.description) parts.push(skill.description);
    parts.push(JSON.stringify(skill.signature));
    return parts.join('\n');
  }

  /**
   * Compute composite skill score from similarity and metadata
   * VectorBackend provides normalized similarity (0-1)
   */
  private computeSkillScore(skill: Skill & { similarity: number }): number {
    // Composite score: similarity * 0.4 + success_rate * 0.3 + (uses/1000) * 0.1 + avg_reward * 0.2
    const uses = skill.uses ?? 0;
    const avgReward = skill.avgReward ?? 0;

    return (
      skill.similarity * 0.4 +
      skill.successRate * 0.3 +
      Math.min(uses / 1000, 1.0) * 0.1 +
      avgReward * 0.2
    );
  }
}
