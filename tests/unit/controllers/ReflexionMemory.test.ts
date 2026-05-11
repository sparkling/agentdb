/**
 * Unit Tests for ReflexionMemory Controller
 *
 * ADR-0170 Phase B.2: ported from better-sqlite3 to a postgres-shaped fake
 * backend. The fake implements just the SQL surface ReflexionMemory exercises
 * (INSERT/SELECT/DELETE on `episodes` and `episode_embeddings`), normalised
 * to postgres dialect ($N placeholders, RETURNING id, BOOLEAN success,
 * BYTEA embedding payloads, ON CONFLICT idempotency). This keeps the unit
 * tests fast and free of native bindings while still asserting end-to-end
 * controller behaviour against postgres-shaped row data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ReflexionMemory, Episode } from '../../../src/controllers/ReflexionMemory.js';
import { EmbeddingService } from '../../../src/controllers/EmbeddingService.js';

// ---------- minimal in-memory postgres-shaped fake ----------
type Row = Record<string, any>;

class FakePostgresBackend {
  private nextEpisodeId = 1;
  episodes: Row[] = [];
  embeddings: Row[] = [];

  async exec(_sql: string): Promise<void> {
    // bootstrapSchema is a no-op in the fake
  }

  async query(sql: string, params: any[] = []): Promise<{ rows: any[]; rowCount?: number }> {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm.startsWith('INSERT INTO episodes')) {
      const id = this.nextEpisodeId++;
      this.episodes.push({
        id,
        ts: Math.floor(Date.now() / 1000),
        session_id: params[0],
        task: params[1],
        input: params[2],
        output: params[3],
        critique: params[4],
        reward: params[5],
        success: params[6],
        latency_ms: params[7],
        tokens_used: params[8],
        tags: params[9],
        metadata: params[10],
      });
      return { rows: [{ id }], rowCount: 1 };
    }

    if (norm.startsWith('INSERT INTO episode_embeddings')) {
      const idx = this.embeddings.findIndex((e) => e.episode_id === params[0]);
      if (idx >= 0) this.embeddings[idx] = { episode_id: params[0], embedding: params[1] };
      else this.embeddings.push({ episode_id: params[0], embedding: params[1] });
      return { rows: [], rowCount: 1 };
    }

    if (norm.startsWith('DELETE FROM episodes')) {
      const before = this.episodes.length;
      if (norm.includes('id IN')) {
        // Prune subquery — the fake doesn't run window functions; emulate
        // by dropping any episodes whose IDs the caller supplied directly.
        // The controller's prune query passes minReward/maxAge/keepMin as
        // params and uses ROW_NUMBER() server-side. Just no-op the deletion
        // for the simple fake.
        return { rows: [], rowCount: 0 };
      }
      this.episodes = this.episodes.filter((e) => e.id !== params[0]);
      return { rows: [], rowCount: before - this.episodes.length };
    }

    if (norm.startsWith('DELETE FROM episode_embeddings')) {
      const before = this.embeddings.length;
      this.embeddings = this.embeddings.filter((e) => e.episode_id !== params[0]);
      return { rows: [], rowCount: before - this.embeddings.length };
    }

    if (norm.startsWith('SELECT e.*, ee.embedding') || norm.includes('FROM episodes e JOIN episode_embeddings')) {
      // SQL fallback retrieval — return all episodes joined with embeddings,
      // applying any filters baked into the SQL via the param list.
      let rows = this.episodes
        .map((e) => {
          const emb = this.embeddings.find((x) => x.episode_id === e.id);
          if (!emb) return null;
          return { ...e, embedding: emb.embedding };
        })
        .filter((r): r is Row => r !== null);

      // Apply minReward filter (first $N parameter when filters.minReward)
      // We can't reliably introspect the param order from SQL text without
      // a real parser, but the controller's tests only exercise simple
      // filter combinations. Apply the trivially-extractable ones:
      if (norm.includes('e.reward >=')) {
        const minReward = params[0];
        rows = rows.filter((r) => r.reward >= minReward);
      }
      if (norm.includes('e.success = FALSE')) {
        rows = rows.filter((r) => r.success === false);
      }
      if (norm.includes('e.success = TRUE')) {
        rows = rows.filter((r) => r.success === true);
      }

      // Apply ORDER BY e.reward DESC
      rows.sort((a, b) => b.reward - a.reward);
      return { rows, rowCount: rows.length };
    }

    if (norm.startsWith('SELECT * FROM episodes WHERE id IN')) {
      // The fake doesn't parse $N placeholders, so receive the IDs in params
      const idSet = new Set(params);
      const rows = this.episodes.filter((e) => idSet.has(e.id));
      return { rows, rowCount: rows.length };
    }

    if (norm.startsWith('SELECT * FROM episodes WHERE session_id')) {
      const sessionId = params[0];
      const limit = params[1] ?? 10;
      const rows = this.episodes
        .filter((e) => e.session_id === sessionId)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, limit);
      return { rows, rowCount: rows.length };
    }

    if (norm.includes('COUNT(*)') && norm.includes('FROM episodes')) {
      const task = params[0];
      const filtered = this.episodes.filter((e) => e.task === task);
      const total = filtered.length;
      const successRate = total === 0 ? 0 : filtered.filter((e) => e.success).length / total;
      const avgReward = total === 0 ? 0 : filtered.reduce((s, e) => s + e.reward, 0) / total;
      const avgLatency =
        total === 0
          ? 0
          : filtered.reduce((s, e) => s + (e.latency_ms ?? 0), 0) / total;
      return {
        rows: [{ total, success_rate: successRate, avg_reward: avgReward, avg_latency: avgLatency }],
        rowCount: 1,
      };
    }

    if (norm.includes('recent_reward') && norm.includes('older_reward')) {
      // Trend query — return neutral values; tests don't exercise the trend.
      return { rows: [{ recent_reward: null, older_reward: null }], rowCount: 1 };
    }

    if (norm.startsWith('SELECT id, session_id, ts FROM episodes WHERE id =')) {
      const ep = this.episodes.find((e) => e.id === params[0]);
      return { rows: ep ? [ep] : [], rowCount: ep ? 1 : 0 };
    }

    if (norm.includes('FROM episode_embeddings ee JOIN episodes e')) {
      // GNN enhance neighbor fetch
      const idSet = new Set(params);
      const rows = this.embeddings
        .filter((e) => idSet.has(e.episode_id))
        .map((e) => {
          const ep = this.episodes.find((x) => x.id === e.episode_id);
          return { embedding: e.embedding, reward: ep?.reward ?? 0 };
        });
      return { rows, rowCount: rows.length };
    }

    if (norm.startsWith('SELECT')) {
      return { rows: [], rowCount: 0 };
    }

    throw new Error(`FakePostgresBackend: unsupported SQL: ${norm}`);
  }
}

describe('ReflexionMemory', () => {
  let db: FakePostgresBackend;
  let embedder: EmbeddingService;
  let reflexion: ReflexionMemory;

  beforeEach(async () => {
    ReflexionMemory._resetSingleton();
    db = new FakePostgresBackend();
    embedder = new EmbeddingService({
      model: 'mock-model',
      dimension: 384,
      provider: 'local',
    });
    await embedder.initialize();

    reflexion = new ReflexionMemory(db as any, embedder);
  });

  describe('storeEpisode', () => {
    it('should store episode with all fields', async () => {
      const episode: Episode = {
        sessionId: 'session-1',
        task: 'implement_auth',
        input: 'Need OAuth2',
        output: 'Implemented OAuth2 with PKCE',
        critique: 'Works well, good security',
        reward: 0.95,
        success: true,
        latencyMs: 1200,
        tokensUsed: 500,
      };

      const episodeId = await reflexion.storeEpisode(episode);

      expect(episodeId).toBeGreaterThan(0);
      expect(typeof episodeId).toBe('number');
    });

    it('should store episode with minimal fields', async () => {
      const episode: Episode = {
        sessionId: 'session-2',
        task: 'fix_bug',
        reward: 0.7,
        success: true,
      };

      const episodeId = await reflexion.storeEpisode(episode);

      expect(episodeId).toBeGreaterThan(0);
    });

    it('should store failed episode with critique', async () => {
      const episode: Episode = {
        sessionId: 'session-3',
        task: 'implement_cache',
        critique: 'Redis timeout issues - need retry logic',
        reward: 0.2,
        success: false,
      };

      const episodeId = await reflexion.storeEpisode(episode);

      expect(episodeId).toBeGreaterThan(0);
    });

    it('should generate and store embeddings', async () => {
      const episode: Episode = {
        sessionId: 'session-4',
        task: 'test task with embedding',
        reward: 0.8,
        success: true,
      };

      const episodeId = await reflexion.storeEpisode(episode);

      // Verify embedding was stored (postgres BYTEA surfaces as Buffer)
      const embRow = db.embeddings.find((e) => e.episode_id === episodeId);
      expect(embRow).toBeDefined();
      expect(Buffer.isBuffer(embRow!.embedding)).toBe(true);
    });
  });

  describe('retrieveRelevant', () => {
    beforeEach(async () => {
      const episodes: Episode[] = [
        {
          sessionId: 'seed-1',
          task: 'implement JWT authentication',
          reward: 0.95,
          success: true,
          critique: 'JWT with 24h expiry works well',
        },
        {
          sessionId: 'seed-2',
          task: 'fix OAuth2 timeout bug',
          reward: 0.88,
          success: true,
          critique: 'Added retry logic for token refresh',
        },
        {
          sessionId: 'seed-3',
          task: 'implement database caching',
          reward: 0.65,
          success: false,
          critique: 'Redis connection issues',
        },
        {
          sessionId: 'seed-4',
          task: 'add authentication middleware',
          reward: 0.92,
          success: true,
        },
      ];

      for (const ep of episodes) {
        await reflexion.storeEpisode(ep);
      }
    });

    it('should retrieve relevant episodes by similarity', async () => {
      const episodes = await reflexion.retrieveRelevant({
        task: 'authentication issues',
        k: 5,
      });

      expect(episodes.length).toBeGreaterThan(0);
      expect(episodes.length).toBeLessThanOrEqual(5);
      expect(episodes[0]).toHaveProperty('id');
      expect(episodes[0]).toHaveProperty('task');
      expect(episodes[0]).toHaveProperty('similarity');
      expect(episodes[0].similarity).toBeGreaterThanOrEqual(0);
      expect(episodes[0].similarity).toBeLessThanOrEqual(1);
    });

    it('should filter by minimum reward', async () => {
      const episodes = await reflexion.retrieveRelevant({
        task: 'authentication',
        k: 10,
        minReward: 0.9,
      });

      episodes.forEach((ep) => {
        expect(ep.reward).toBeGreaterThanOrEqual(0.9);
      });
    });

    it('should filter for failures only', async () => {
      const episodes = await reflexion.retrieveRelevant({
        task: 'database caching',
        k: 10,
        onlyFailures: true,
      });

      episodes.forEach((ep) => {
        expect(ep.success).toBe(false);
      });
    });

    it('should filter for successes only', async () => {
      const episodes = await reflexion.retrieveRelevant({
        task: 'authentication',
        k: 10,
        onlySuccesses: true,
      });

      episodes.forEach((ep) => {
        expect(ep.success).toBe(true);
      });
    });

    it('should respect k limit', async () => {
      const episodes = await reflexion.retrieveRelevant({
        task: 'authentication',
        k: 2,
      });

      expect(episodes.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getTaskStats', () => {
    beforeEach(async () => {
      for (let i = 0; i < 10; i++) {
        await reflexion.storeEpisode({
          sessionId: `stats-${i}`,
          task: 'implement_api',
          reward: 0.7 + i * 0.02,
          success: i > 3,
          latencyMs: 100 + i * 10,
        });
      }
    });

    it('should calculate task statistics', async () => {
      const stats = await reflexion.getTaskStats('implement_api');

      expect(stats.totalAttempts).toBe(10);
      expect(stats.successRate).toBeGreaterThan(0);
      expect(stats.successRate).toBeLessThanOrEqual(1);
      expect(stats.avgReward).toBeGreaterThan(0);
      expect(stats.avgLatency).toBeGreaterThan(0);
    });

    it('should return zero stats for non-existent task', async () => {
      const stats = await reflexion.getTaskStats('non_existent_task');

      expect(stats.totalAttempts).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.avgReward).toBe(0);
    });
  });

  describe('getCritiqueSummary', () => {
    beforeEach(async () => {
      await reflexion.storeEpisode({
        sessionId: 'critique-1',
        task: 'implement caching',
        critique: 'Redis timeout - need better error handling',
        reward: 0.3,
        success: false,
      });

      await reflexion.storeEpisode({
        sessionId: 'critique-2',
        task: 'cache layer implementation',
        critique: 'Connection pool exhausted - increase pool size',
        reward: 0.4,
        success: false,
      });
    });

    it('should generate critique summary from failures', async () => {
      const summary = await reflexion.getCritiqueSummary({
        task: 'caching',
        onlyFailures: true,
      });

      expect(summary).toBeTruthy();
      expect(summary).toContain('failures');
      expect(summary).toContain('lessons learned');
    });

    it('should return message when no failures found', async () => {
      const summary = await reflexion.getCritiqueSummary({
        task: 'completely unknown task',
        onlyFailures: true,
      });

      expect(summary).toContain('No prior failures');
    });
  });

  describe('getSuccessStrategies', () => {
    beforeEach(async () => {
      await reflexion.storeEpisode({
        sessionId: 'success-1',
        task: 'implement OAuth',
        output: 'Used PKCE flow with refresh tokens',
        reward: 0.95,
        success: true,
      });

      await reflexion.storeEpisode({
        sessionId: 'success-2',
        task: 'OAuth implementation',
        output: 'Implemented OAuth2 with state parameter for CSRF protection',
        reward: 0.92,
        success: true,
      });
    });

    it('should generate success strategies summary', async () => {
      const strategies = await reflexion.getSuccessStrategies({
        task: 'OAuth',
        minReward: 0.8,
      });

      expect(strategies).toBeTruthy();
      expect(strategies).toContain('Successful strategies');
    });

    it('should return message when no successes found', async () => {
      const strategies = await reflexion.getSuccessStrategies({
        task: 'unknown task',
        minReward: 0.9,
      });

      expect(strategies).toContain('No successful strategies');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty strings gracefully', async () => {
      const episode: Episode = {
        sessionId: '',
        task: '',
        reward: 0.5,
        success: true,
      };

      const episodeId = await reflexion.storeEpisode(episode);

      expect(episodeId).toBeGreaterThan(0);
    });

    it('should handle Unicode characters', async () => {
      const episode: Episode = {
        sessionId: '测试会话',
        task: 'Implement 🚀 authentication 🔐',
        critique: 'Works perfectly! ✅',
        reward: 0.9,
        success: true,
      };

      const episodeId = await reflexion.storeEpisode(episode);

      expect(episodeId).toBeGreaterThan(0);
    });

    it('should handle reward boundaries', async () => {
      const ep1: Episode = {
        sessionId: 's1',
        task: 't1',
        reward: 0.0,
        success: false,
      };

      const ep2: Episode = {
        sessionId: 's2',
        task: 't2',
        reward: 1.0,
        success: true,
      };

      const id1 = await reflexion.storeEpisode(ep1);
      const id2 = await reflexion.storeEpisode(ep2);

      expect(id1).toBeGreaterThan(0);
      expect(id2).toBeGreaterThan(0);
    });

    it('should handle null/undefined optional fields', async () => {
      const episode: Episode = {
        sessionId: 'test',
        task: 'test task',
        reward: 0.8,
        success: true,
        input: undefined,
        output: undefined,
        critique: undefined,
        latencyMs: undefined,
        tokensUsed: undefined,
      };

      const episodeId = await reflexion.storeEpisode(episode);

      expect(episodeId).toBeGreaterThan(0);
    });
  });

  describe('Performance', () => {
    it('should store 100 episodes efficiently', async () => {
      const startTime = Date.now();

      for (let i = 0; i < 100; i++) {
        await reflexion.storeEpisode({
          sessionId: `perf-${i}`,
          task: `task ${i}`,
          reward: Math.random(),
          success: Math.random() > 0.5,
        });
      }

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(5000); // Should complete in less than 5 seconds
    }, 10000);

    it('should retrieve episodes efficiently', async () => {
      for (let i = 0; i < 50; i++) {
        await reflexion.storeEpisode({
          sessionId: `search-${i}`,
          task: `task ${i % 10}`,
          reward: Math.random(),
          success: true,
        });
      }

      const startTime = Date.now();

      await reflexion.retrieveRelevant({
        task: 'task search',
        k: 10,
      });

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(200); // Should complete in less than 200ms
    });
  });
});
