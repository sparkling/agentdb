/**
 * HierarchicalMemory - 3-Tier Human-like Memory System
 *
 * Implements a biologically-inspired memory hierarchy with:
 * - Working Memory: Active context (fast access, 1MB limit)
 * - Episodic Memory: Recent experiences (hours-days)
 * - Semantic Memory: Long-term knowledge (consolidated)
 *
 * Based on:
 * - Atkinson-Shiffrin Multi-Store Model (1968)
 * - Tulving's Episodic/Semantic Distinction (1972)
 * - Baddeley's Working Memory Model (2000)
 *
 * Features:
 * - Automatic tier promotion based on access frequency and importance
 * - Forgetting curves (Ebbinghaus decay: R = e^(-t/S))
 * - Spaced repetition for consolidation
 * - Context-dependent recall
 * - Memory replay for reinforcement
 *
 * ADR-066 Phase P2-3
 *
 * ADR-0170 Phase B.1 (2026-05-11): ported from SQLite (better-sqlite3) to
 * PostgreSQL via PostgresBackend. The SQLite code path and the Option F
 * `hmem_vec` mirror writes were dead-stripped atomically with this commit.
 * Native vector ops now live alongside the relational row (Phase C
 * pgvector integration); the legacy `vectorBackend.insert(...)` parallel
 * write path remains for the in-memory index until pgvector lands.
 */

import type { PostgresBackend } from '../backends/postgres/PostgresBackend.js';
import type { VectorBackend, SearchResult } from '../backends/VectorBackend.js';
import { EmbeddingService } from './EmbeddingService.js';
import { cosineSimilarity } from '../utils/vector-math.js';

/** Memory tier in the hierarchy */
export type MemoryTier = 'working' | 'episodic' | 'semantic';

/** Memory importance score (0-1, higher = more important) */
export type ImportanceScore = number;

/** Memory item with metadata and embeddings */
export interface MemoryItem {
  id: string;
  tier: MemoryTier;
  content: string;
  embedding?: Float32Array;
  importance: ImportanceScore;
  accessCount: number;
  createdAt: number;
  lastAccessedAt: number;
  lastRehearsedAt?: number;
  consolidatedAt?: number;
  tags?: string[];
  context?: Record<string, any>;
  metadata?: Record<string, any>;
}

/** Query for memory retrieval */
export interface MemoryQuery {
  query: string;
  queryEmbedding?: Float32Array;
  tier?: MemoryTier | MemoryTier[];
  k?: number;
  threshold?: number;
  context?: Record<string, any>;
  includeDecayed?: boolean;
}

/** Memory statistics */
export interface MemoryStats {
  working: {
    count: number;
    sizeBytes: number;
    avgImportance: number;
    avgAccessCount: number;
  };
  episodic: {
    count: number;
    sizeBytes: number;
    avgImportance: number;
    avgAge: number;
  };
  semantic: {
    count: number;
    sizeBytes: number;
    avgImportance: number;
    consolidationRate: number;
  };
  totalMemories: number;
  forgottenCount: number;
  promotionRate: number;
}

/** Forgetting curve configuration */
export interface ForgettingConfig {
  /** Base decay rate (higher = faster forgetting) */
  decayRate: number;
  /** Minimum retention (memories don't decay below this) */
  minRetention: number;
  /** Importance multiplier (important memories decay slower) */
  importanceMultiplier: number;
  /** Rehearsal boost (how much rehearsal extends retention) */
  rehearsalBoost: number;
}

/** Consolidation configuration */
export interface ConsolidationConfig {
  /** Minimum access count for consolidation */
  minAccessCount: number;
  /** Minimum importance for consolidation */
  minImportance: number;
  /** Minimum age (ms) before episodic → semantic */
  minAge: number;
  /** Maximum episodic memories before forced consolidation */
  maxEpisodicSize: number;
}

export interface HierarchicalMemoryConfig {
  /** Working memory size limit (bytes) */
  workingMemoryLimit: number;
  /** Episodic memory time window (ms) */
  episodicWindow: number;
  /** Forgetting curve parameters */
  forgetting: ForgettingConfig;
  /** Consolidation parameters */
  consolidation: ConsolidationConfig;
  /** Enable automatic consolidation */
  autoConsolidate: boolean;
}

/**
 * Row shape returned by postgres SELECTs against `hierarchical_memory`.
 * Field names match the (snake_case) column names; row hydration to
 * MemoryItem happens in hydrateRow().
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

export class HierarchicalMemory {
  private backend: PostgresBackend;
  private embedder: EmbeddingService;
  private vectorBackend?: VectorBackend;
  private config: HierarchicalMemoryConfig;
  private schemaReady: Promise<void>;

  // In-memory caches for fast access
  private workingMemoryCache = new Map<string, MemoryItem>();
  private episodicMemoryIndex = new Map<string, MemoryItem>();

  // Stats tracking
  private stats = {
    totalAccesses: 0,
    promotions: 0,
    consolidations: 0,
    forgotten: 0,
  };

  constructor(
    backend: PostgresBackend,
    embedder: EmbeddingService,
    vectorBackend?: VectorBackend,
    config?: Partial<HierarchicalMemoryConfig>,
  ) {
    this.backend = backend;
    this.embedder = embedder;
    this.vectorBackend = vectorBackend;

    this.config = {
      workingMemoryLimit: 1024 * 1024, // 1MB
      episodicWindow: 7 * 24 * 60 * 60 * 1000, // 7 days
      forgetting: {
        decayRate: 0.3,
        minRetention: 0.1,
        importanceMultiplier: 2.0,
        rehearsalBoost: 1.5,
      },
      consolidation: {
        minAccessCount: 3,
        minImportance: 0.6,
        minAge: 24 * 60 * 60 * 1000, // 24 hours
        maxEpisodicSize: 1000,
      },
      autoConsolidate: true,
      ...config,
    };

    this.schemaReady = this.initializeDatabase();
  }

  /**
   * Initialize database tables for hierarchical memory.
   *
   * The returned promise is awaited by every public method (`store`,
   * `recall`, `forget`, `getStats`, …) before issuing its own SQL, so
   * callers don't have to gate on a separate ready() promise.
   *
   * `backend.initialize()` is idempotent — the first controller to touch
   * the shared PostgresBackend pays the cluster-warm-up cost; subsequent
   * controllers no-op.
   */
  private async initializeDatabase(): Promise<void> {
    await this.backend.initialize();
    await this.backend.exec(`
      CREATE TABLE IF NOT EXISTS hierarchical_memory (
        id TEXT PRIMARY KEY,
        tier TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL NOT NULL,
        access_count BIGINT DEFAULT 0,
        created_at BIGINT NOT NULL,
        last_accessed_at BIGINT NOT NULL,
        last_rehearsed_at BIGINT,
        consolidated_at BIGINT,
        tags TEXT,
        context TEXT,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_hierarchical_tier ON hierarchical_memory(tier);
      CREATE INDEX IF NOT EXISTS idx_hierarchical_importance ON hierarchical_memory(importance);
      CREATE INDEX IF NOT EXISTS idx_hierarchical_access ON hierarchical_memory(access_count);
      CREATE INDEX IF NOT EXISTS idx_hierarchical_created ON hierarchical_memory(created_at);
    `);
  }

  /**
   * Store a new memory item
   */
  async store(
    content: string,
    importance: ImportanceScore = 0.5,
    tier: MemoryTier = 'working',
    options?: {
      tags?: string[];
      context?: Record<string, any>;
      metadata?: Record<string, any>;
    },
  ): Promise<string> {
    await this.schemaReady;

    const id = `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    // Generate embedding
    const embedding = await this.embedder.embed(content);

    const item: MemoryItem = {
      id,
      tier,
      content,
      embedding,
      importance,
      accessCount: 0,
      createdAt: now,
      lastAccessedAt: now,
      tags: options?.tags,
      context: options?.context,
      metadata: options?.metadata,
    };

    await this.backend.query(
      `INSERT INTO hierarchical_memory (
        id, tier, content, importance, access_count,
        created_at, last_accessed_at, tags, context, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        tier,
        content,
        importance,
        0,
        now,
        now,
        options?.tags ? JSON.stringify(options.tags) : null,
        options?.context ? JSON.stringify(options.context) : null,
        options?.metadata ? JSON.stringify(options.metadata) : null,
      ],
    );

    // Add to vector backend if available
    if (this.vectorBackend) {
      this.vectorBackend.insert(id, embedding, {
        tier,
        importance,
        createdAt: now,
        ...options?.metadata,
      });
    }

    // Cache in appropriate tier
    if (tier === 'working') {
      this.workingMemoryCache.set(id, item);
      await this.enforceWorkingMemoryLimit();
    } else if (tier === 'episodic') {
      this.episodicMemoryIndex.set(id, item);
    }

    // Trigger auto-consolidation if needed
    if (this.config.autoConsolidate) {
      await this.checkConsolidation();
    }

    return id;
  }

  /**
   * Retrieve memories matching the query
   */
  async recall(query: MemoryQuery): Promise<MemoryItem[]> {
    await this.schemaReady;

    this.stats.totalAccesses++;

    // Generate embedding if not provided
    const queryEmbedding = query.queryEmbedding || (await this.embedder.embed(query.query));

    // Determine which tiers to search
    const tiers = Array.isArray(query.tier)
      ? query.tier
      : query.tier
        ? [query.tier]
        : ['working', 'episodic', 'semantic'];

    const k = query.k || 10;
    const threshold = query.threshold || 0.5;

    let results: MemoryItem[] = [];

    // Search vector backend if available (faster)
    if (this.vectorBackend) {
      const searchResults: SearchResult[] = [];

      for (const tier of tiers) {
        const tierResults = await this.vectorBackend.search(queryEmbedding, k, {
          threshold,
          filter: { tier },
        });
        searchResults.push(...tierResults);
      }

      // Convert to MemoryItems
      results = await Promise.all(
        searchResults.map(async (result) => {
          const item = await this.getMemoryById(result.id);
          if (item) {
            item.metadata = { ...item.metadata, similarity: result.similarity };
          }
          return item;
        }),
      ).then((items) => items.filter((item): item is MemoryItem => item !== null));
    } else {
      // Fallback: manual search
      results = await this.manualSearch(
        queryEmbedding,
        ['working', 'episodic', 'semantic'] as MemoryTier[],
        k,
        threshold,
      );
    }

    // Apply forgetting curve if not including decayed
    if (!query.includeDecayed) {
      results = results.filter(
        (item) => this.calculateRetention(item) >= this.config.forgetting.minRetention,
      );
    }

    // Context-dependent recall
    if (query.context) {
      results = this.applyContextFilter(results, query.context);
    }

    // Update access tracking and promote if needed
    await this.updateAccessTracking(results.map((r) => r.id));

    return results.slice(0, k);
  }

  /**
   * Promote memory to higher tier based on importance and access
   */
  async promote(memoryId: string): Promise<boolean> {
    const item = await this.getMemoryById(memoryId);
    if (!item) return false;

    let newTier: MemoryTier | null = null;

    // Working → Episodic: After multiple accesses
    if (item.tier === 'working' && item.accessCount >= 2) {
      newTier = 'episodic';
    }

    // Episodic → Semantic: Based on consolidation criteria
    if (item.tier === 'episodic') {
      const age = Date.now() - item.createdAt;
      if (
        item.accessCount >= this.config.consolidation.minAccessCount &&
        item.importance >= this.config.consolidation.minImportance &&
        age >= this.config.consolidation.minAge
      ) {
        newTier = 'semantic';
      }
    }

    if (newTier) {
      await this.updateTier(memoryId, newTier);
      this.stats.promotions++;
      return true;
    }

    return false;
  }

  /**
   * Rehearse a memory to strengthen retention
   */
  async rehearse(memoryId: string): Promise<void> {
    await this.schemaReady;

    const now = Date.now();

    await this.backend.query(
      `UPDATE hierarchical_memory
       SET last_rehearsed_at = $1, access_count = access_count + 1
       WHERE id = $2`,
      [now, memoryId],
    );

    // Update cache
    const item = this.workingMemoryCache.get(memoryId) || this.episodicMemoryIndex.get(memoryId);
    if (item) {
      item.lastRehearsedAt = now;
      item.accessCount++;
    }
  }

  /**
   * Calculate retention score using Ebbinghaus forgetting curve
   * R(t) = e^(-t/S)
   * Where S = base_strength * importance_multiplier * rehearsal_boost
   */
  private calculateRetention(item: MemoryItem): number {
    const now = Date.now();
    const timeSinceCreation = (now - item.createdAt) / (24 * 60 * 60 * 1000); // days
    const timeSinceRehearsal = item.lastRehearsedAt
      ? (now - item.lastRehearsedAt) / (24 * 60 * 60 * 1000)
      : timeSinceCreation;

    // Calculate strength (inverse of decay rate)
    const baseStrength = 1 / this.config.forgetting.decayRate;
    const importanceBoost = 1 + item.importance * this.config.forgetting.importanceMultiplier;
    const rehearsalBoost = item.lastRehearsedAt ? this.config.forgetting.rehearsalBoost : 1.0;

    const strength = baseStrength * importanceBoost * rehearsalBoost;

    // Ebbinghaus formula
    const retention = Math.exp(-timeSinceRehearsal / strength);

    return Math.max(retention, this.config.forgetting.minRetention);
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<MemoryStats> {
    await this.schemaReady;

    const workingRes = await this.backend.query(
      `SELECT
         COUNT(*)::BIGINT as count,
         AVG(importance) as "avgImportance",
         AVG(access_count) as "avgAccessCount",
         SUM(LENGTH(content)) as "sizeBytes"
       FROM hierarchical_memory WHERE tier = 'working'`,
    );
    const workingStats = (workingRes.rows[0] ?? {}) as Record<string, unknown>;

    const episodicRes = await this.backend.query(
      `SELECT
         COUNT(*)::BIGINT as count,
         AVG(importance) as "avgImportance",
         AVG($1::BIGINT - created_at) as "avgAge",
         SUM(LENGTH(content)) as "sizeBytes"
       FROM hierarchical_memory WHERE tier = 'episodic'`,
      [Date.now()],
    );
    const episodicStats = (episodicRes.rows[0] ?? {}) as Record<string, unknown>;

    const semanticRes = await this.backend.query(
      `SELECT
         COUNT(*)::BIGINT as count,
         AVG(importance) as "avgImportance",
         COUNT(CASE WHEN consolidated_at IS NOT NULL THEN 1 END)::BIGINT as consolidated,
         SUM(LENGTH(content)) as "sizeBytes"
       FROM hierarchical_memory WHERE tier = 'semantic'`,
    );
    const semanticStats = (semanticRes.rows[0] ?? {}) as Record<string, unknown>;

    const workingCount = Number(workingStats.count ?? 0);
    const episodicCount = Number(episodicStats.count ?? 0);
    const semanticCount = Number(semanticStats.count ?? 0);
    const semanticConsolidated = Number(semanticStats.consolidated ?? 0);

    const totalMemories = workingCount + episodicCount + semanticCount;
    const promotionRate = totalMemories > 0 ? this.stats.promotions / totalMemories : 0;

    return {
      working: {
        count: workingCount,
        sizeBytes: Number(workingStats.sizeBytes ?? 0),
        avgImportance: Number(workingStats.avgImportance ?? 0),
        avgAccessCount: Number(workingStats.avgAccessCount ?? 0),
      },
      episodic: {
        count: episodicCount,
        sizeBytes: Number(episodicStats.sizeBytes ?? 0),
        avgImportance: Number(episodicStats.avgImportance ?? 0),
        avgAge: Number(episodicStats.avgAge ?? 0),
      },
      semantic: {
        count: semanticCount,
        sizeBytes: Number(semanticStats.sizeBytes ?? 0),
        avgImportance: Number(semanticStats.avgImportance ?? 0),
        consolidationRate: semanticCount > 0 ? semanticConsolidated / semanticCount : 0,
      },
      totalMemories,
      forgottenCount: this.stats.forgotten,
      promotionRate,
    };
  }

  /**
   * Enforce working memory size limit by evicting least important items
   */
  private async enforceWorkingMemoryLimit(): Promise<void> {
    const currentSize = this.calculateWorkingMemorySize();

    if (currentSize > this.config.workingMemoryLimit) {
      // Get working memories sorted by importance * retention
      const memories = Array.from(this.workingMemoryCache.values())
        .map((item) => ({
          ...item,
          score: item.importance * this.calculateRetention(item),
        }))
        .sort((a, b) => a.score - b.score);

      // Evict until under limit
      let freedSize = 0;
      for (const memory of memories) {
        if (currentSize - freedSize <= this.config.workingMemoryLimit) break;

        // Promote to episodic or forget
        if (memory.score > 0.3) {
          await this.updateTier(memory.id, 'episodic');
        } else {
          await this.forget(memory.id);
        }

        freedSize += new TextEncoder().encode(memory.content).length;
        this.workingMemoryCache.delete(memory.id);
      }
    }
  }

  /**
   * Calculate current working memory size in bytes
   */
  private calculateWorkingMemorySize(): number {
    let size = 0;
    for (const item of this.workingMemoryCache.values()) {
      size += new TextEncoder().encode(item.content).length;
    }
    return size;
  }

  /**
   * Update memory tier
   */
  private async updateTier(memoryId: string, newTier: MemoryTier): Promise<void> {
    await this.schemaReady;

    const now = Date.now();

    await this.backend.query(
      `UPDATE hierarchical_memory
       SET tier = $1, consolidated_at = $2
       WHERE id = $3`,
      [newTier, newTier === 'semantic' ? now : null, memoryId],
    );

    // Update caches
    const item = this.workingMemoryCache.get(memoryId) || this.episodicMemoryIndex.get(memoryId);
    if (item) {
      item.tier = newTier;
      if (newTier === 'semantic') {
        item.consolidatedAt = now;
      }

      // Move between caches
      this.workingMemoryCache.delete(memoryId);
      this.episodicMemoryIndex.delete(memoryId);

      if (newTier === 'working') {
        this.workingMemoryCache.set(memoryId, item);
      } else if (newTier === 'episodic') {
        this.episodicMemoryIndex.set(memoryId, item);
      }
    }

    // Update vector backend metadata
    if (this.vectorBackend && item?.embedding) {
      this.vectorBackend.insert(memoryId, item.embedding, {
        tier: newTier,
        consolidated: newTier === 'semantic',
      });
    }
  }

  /**
   * Forget (delete) a memory
   */
  private async forget(memoryId: string): Promise<void> {
    await this.schemaReady;

    await this.backend.query(`DELETE FROM hierarchical_memory WHERE id = $1`, [memoryId]);
    this.workingMemoryCache.delete(memoryId);
    this.episodicMemoryIndex.delete(memoryId);
    this.stats.forgotten++;

    // Remove from vector backend
    if (this.vectorBackend) {
      this.vectorBackend.remove(memoryId);
    }
  }

  /**
   * Hydrate a raw row into a MemoryItem. Shared by getMemoryById and
   * manualSearch.
   */
  private hydrateRow(row: HierarchicalMemoryRow): MemoryItem {
    return {
      id: row.id,
      tier: row.tier,
      content: row.content,
      importance: Number(row.importance),
      accessCount: Number(row.access_count),
      createdAt: Number(row.created_at),
      lastAccessedAt: Number(row.last_accessed_at),
      lastRehearsedAt: row.last_rehearsed_at != null ? Number(row.last_rehearsed_at) : undefined,
      consolidatedAt: row.consolidated_at != null ? Number(row.consolidated_at) : undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      context: row.context ? JSON.parse(row.context) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /**
   * Get memory item by ID
   */
  private async getMemoryById(id: string): Promise<MemoryItem | null> {
    // Check caches first
    const cached = this.workingMemoryCache.get(id) || this.episodicMemoryIndex.get(id);
    if (cached) return cached;

    await this.schemaReady;

    // Fetch from database
    const res = await this.backend.query(`SELECT * FROM hierarchical_memory WHERE id = $1`, [id]);
    const row = res.rows[0] as HierarchicalMemoryRow | undefined;
    if (!row) return null;

    return this.hydrateRow(row);
  }

  /**
   * Manual search without vector backend
   */
  private async manualSearch(
    queryEmbedding: Float32Array,
    tiers: MemoryTier[],
    k: number,
    threshold: number,
  ): Promise<MemoryItem[]> {
    await this.schemaReady;

    // postgres accepts an array bind for IN-list via `= ANY($1::TEXT[])`.
    const res = await this.backend.query(
      `SELECT * FROM hierarchical_memory
       WHERE tier = ANY($1::TEXT[])
       ORDER BY importance DESC
       LIMIT $2`,
      [tiers, k * 2],
    );
    const rows = res.rows as HierarchicalMemoryRow[];

    const results: Array<MemoryItem & { similarity: number }> = [];

    for (const row of rows) {
      const embedding = await this.embedder.embed(row.content);
      const similarity = cosineSimilarity(queryEmbedding, embedding);

      if (similarity >= threshold) {
        const item = this.hydrateRow(row);
        results.push({
          ...item,
          embedding,
          similarity,
        });
      }
    }

    return results.sort((a, b) => b.similarity - a.similarity).slice(0, k);
  }

  /**
   * Apply context filter to results
   */
  private applyContextFilter(
    results: MemoryItem[],
    context: Record<string, any>,
  ): MemoryItem[] {
    return results.filter((item) => {
      if (!item.context) return false;

      // Check if at least 50% of context keys match
      const keys = Object.keys(context);
      const matches = keys.filter((key) => item.context![key] === context[key]).length;

      return matches / keys.length >= 0.5;
    });
  }

  /**
   * Update access tracking for retrieved memories
   */
  private async updateAccessTracking(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.schemaReady;

    const now = Date.now();

    await this.backend.query(
      `UPDATE hierarchical_memory
       SET access_count = access_count + 1, last_accessed_at = $1
       WHERE id = ANY($2::TEXT[])`,
      [now, ids],
    );

    // Update caches
    for (const id of ids) {
      const item = this.workingMemoryCache.get(id) || this.episodicMemoryIndex.get(id);
      if (item) {
        item.accessCount++;
        item.lastAccessedAt = now;

        // Check for promotion
        await this.promote(id);
      }
    }
  }

  /**
   * Check if consolidation is needed and trigger if necessary
   */
  private async checkConsolidation(): Promise<void> {
    const episodicCount = this.episodicMemoryIndex.size;

    if (episodicCount >= this.config.consolidation.maxEpisodicSize) {
      // Trigger consolidation (will be handled by MemoryConsolidation service)
      console.log(
        `⚠️ Episodic memory full (${episodicCount} items). Consolidation recommended.`,
      );
    }
  }
}
