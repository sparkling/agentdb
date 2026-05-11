/**
 * Unit Tests for CausalRecall Controller
 *
 * ADR-0170 Phase B.11: ported from better-sqlite3 (sync) to PostgresBackend
 * (pglite embedded, async). Each test gets a fresh ephemeral pglite cluster
 * under `os.tmpdir()`. The CausalMemoryGraph + ExplainableRecall singletons
 * are reset in beforeEach/afterEach so each test gets fresh dependents tied
 * to the same backend.
 *
 * Tests utility-based reranking, certificate issuance, and causal-aware
 * retrieval against the postgres substrate.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CausalRecall, RerankConfig } from '../../../src/controllers/CausalRecall.js';
import { CausalMemoryGraph } from '../../../src/controllers/CausalMemoryGraph.js';
import { ExplainableRecall } from '../../../src/controllers/ExplainableRecall.js';
import { EmbeddingService } from '../../../src/controllers/EmbeddingService.js';
import { PostgresBackend } from '../../../src/backends/postgres/PostgresBackend.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('CausalRecall', () => {
  let backend: PostgresBackend;
  let dataDir: string;
  let embedder: EmbeddingService;
  let causalRecall: CausalRecall;

  beforeEach(async () => {
    // Reset dependent singletons so each test gets fresh controllers tied
    // to this test's pglite cluster.
    CausalMemoryGraph._resetSingleton();
    ExplainableRecall._resetSingleton();

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdb-causal-recall-test-'));
    backend = new PostgresBackend({ metric: 'cosine', dataDir });
    await backend.initialize();

    // Load canonical postgres-dialect schemas (Phase A.5) for
    // episodes / episode_embeddings / causal_edges / recall_certificates /
    // provenance_sources / justification_paths.
    const schemaPath = path.join(__dirname, '../../../src/schemas/schema.sql');
    if (fs.existsSync(schemaPath)) {
      await backend.exec(fs.readFileSync(schemaPath, 'utf-8'));
    }
    const frontierSchemaPath = path.join(__dirname, '../../../src/schemas/frontier-schema.sql');
    if (fs.existsSync(frontierSchemaPath)) {
      await backend.exec(fs.readFileSync(frontierSchemaPath, 'utf-8'));
    }

    embedder = new EmbeddingService({
      model: 'mock-model',
      dimension: 384,
      provider: 'local',
    });
    await embedder.initialize();

    // The ExplainableRecall companion needs its initialize() to ensure
    // the recall_certificates DDL is in place (matches Wave 1a pattern).
    const explainable = new ExplainableRecall(backend);
    await explainable.initialize();

    causalRecall = new CausalRecall(backend, embedder, undefined, undefined, undefined, explainable);
  });

  afterEach(async () => {
    CausalMemoryGraph._resetSingleton();
    ExplainableRecall._resetSingleton();
    try {
      backend.close();
    } catch {
      /* best-effort */
    }
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  /**
   * Helper: insert an episode with an embedding, return its BIGINT id as number.
   */
  async function insertEpisode(
    sessionId: string,
    task: string,
    output: string,
    reward: number,
    ts: number,
    latencyMs: number,
  ): Promise<number> {
    const res = await backend.query(
      `INSERT INTO episodes (session_id, task, output, reward, ts, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [sessionId, task, output, reward, ts, latencyMs],
    );
    const id = Number((res.rows[0] as { id: number | string }).id);

    const embedding = await embedder.embed(`${task} ${output}`);
    await backend.query(
      `INSERT INTO episode_embeddings (episode_id, embedding)
       VALUES ($1, $2)`,
      [id, Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)],
    );

    return id;
  }

  describe('Constructor', () => {
    it('should initialize with default config', () => {
      expect(causalRecall).toBeDefined();
    });

    it('should accept custom config', () => {
      const customConfig: RerankConfig = {
        alpha: 0.8,
        beta: 0.15,
        gamma: 0.05,
        minConfidence: 0.7,
      };

      const customRecall = new CausalRecall(backend, embedder, undefined, customConfig);
      expect(customRecall).toBeDefined();
    });

    it('should accept vector backend', () => {
      const mockBackend = {
        search: vi.fn().mockReturnValue([]),
      };

      const recallWithBackend = new CausalRecall(backend, embedder, mockBackend as any);
      expect(recallWithBackend).toBeDefined();
    });
  });

  describe('recall', () => {
    beforeEach(async () => {
      for (let i = 0; i < 10; i++) {
        await insertEpisode(
          'test-session',
          `Task ${i}`,
          `Output for task ${i}`,
          0.5 + i * 0.05,
          Math.floor(Date.now() / 1000) + i,
          100 + i * 10,
        );
      }
    });

    it('should return CausalRecallResult with candidates and certificate', async () => {
      const result = await causalRecall.recall(
        'query-1',
        'test query for retrieval',
        5,
      );

      expect(result).toBeDefined();
      expect(result.queryId).toBe('query-1');
      expect(result.candidates).toBeDefined();
      expect(result.certificate).toBeDefined();
      expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics).toBeDefined();
    });

    it('should return k candidates', async () => {
      const k = 3;
      const result = await causalRecall.recall(
        'query-2',
        'test query',
        k,
      );

      expect(result.candidates.length).toBeLessThanOrEqual(k);
    });

    it('should include metrics in result', async () => {
      const result = await causalRecall.recall(
        'query-3',
        'test query',
        5,
      );

      expect(result.metrics.vectorSearchMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics.causalLookupMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics.rerankMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics.certificateMs).toBeGreaterThanOrEqual(0);
    });

    it('should assign ranks to candidates', async () => {
      const result = await causalRecall.recall(
        'query-4',
        'test query',
        5,
      );

      if (result.candidates.length > 0) {
        result.candidates.forEach((candidate, idx) => {
          expect(candidate.rank).toBe(idx + 1);
        });
      }
    });

    it('should calculate utility scores', async () => {
      const result = await causalRecall.recall(
        'query-5',
        'test query',
        5,
      );

      if (result.candidates.length > 0) {
        result.candidates.forEach(candidate => {
          expect(typeof candidate.utilityScore).toBe('number');
          expect(typeof candidate.similarity).toBe('number');
        });
      }
    });

    it('should respect access level', async () => {
      const result = await causalRecall.recall(
        'query-6',
        'test query',
        5,
        undefined,
        'confidential',
      );

      expect(result.certificate.accessLevel).toBe('confidential');
    });

    it('should handle custom requirements', async () => {
      const requirements = ['task', 'output', 'result'];
      const result = await causalRecall.recall(
        'query-7',
        'test query',
        5,
        requirements,
      );

      expect(result.certificate).toBeDefined();
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      for (let i = 0; i < 10; i++) {
        await insertEpisode(
          'test-session',
          `Task ${i}`,
          `Output for task ${i}`,
          0.5 + i * 0.05,
          Math.floor(Date.now() / 1000) + i,
          100 + i * 10,
        );
      }
    });

    it('should search with default parameters', async () => {
      const results = await causalRecall.search({
        query: 'test search query',
      });

      expect(Array.isArray(results)).toBe(true);
    });

    it('should respect k parameter', async () => {
      const k = 5;
      const results = await causalRecall.search({
        query: 'test search query',
        k,
      });

      expect(results.length).toBeLessThanOrEqual(k);
    });

    it('should include utility scores in results', async () => {
      const results = await causalRecall.search({
        query: 'test search query',
        k: 5,
      });

      if (results.length > 0) {
        results.forEach(result => {
          expect(typeof result.utilityScore).toBe('number');
          expect(typeof result.similarity).toBe('number');
          expect(typeof result.causalUplift).toBe('number');
        });
      }
    });

    it('should allow custom alpha/beta/gamma weights', async () => {
      const results = await causalRecall.search({
        query: 'test search query',
        k: 5,
        alpha: 0.9,
        beta: 0.05,
        gamma: 0.05,
      });

      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('batchRecall', () => {
    beforeEach(async () => {
      for (let i = 0; i < 5; i++) {
        await insertEpisode(
          'test-session',
          `Task ${i}`,
          `Output ${i}`,
          0.8,
          Math.floor(Date.now() / 1000) + i,
          100,
        );
      }
    });

    it('should handle batch queries', async () => {
      const queries = [
        { queryId: 'batch-1', queryText: 'first query' },
        { queryId: 'batch-2', queryText: 'second query' },
        { queryId: 'batch-3', queryText: 'third query' },
      ];

      const results = await causalRecall.batchRecall(queries);

      expect(results).toHaveLength(3);
      results.forEach((result, idx) => {
        expect(result.queryId).toBe(queries[idx].queryId);
      });
    });

    it('should handle batch with custom k', async () => {
      const queries = [
        { queryId: 'batch-1', queryText: 'query 1', k: 2 },
        { queryId: 'batch-2', queryText: 'query 2', k: 3 },
      ];

      const results = await causalRecall.batchRecall(queries);

      expect(results[0].candidates.length).toBeLessThanOrEqual(2);
      expect(results[1].candidates.length).toBeLessThanOrEqual(3);
    });

    it('should handle empty batch', async () => {
      const results = await causalRecall.batchRecall([]);

      expect(results).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      const stats = await causalRecall.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats.totalCausalEdges).toBe('number');
      expect(typeof stats.totalCertificates).toBe('number');
      expect(typeof stats.avgRedundancyRatio).toBe('number');
      expect(typeof stats.avgCompletenessScore).toBe('number');
    });

    it('should return zero stats for empty database', async () => {
      const stats = await causalRecall.getStats();

      expect(stats.totalCausalEdges).toBe(0);
      expect(stats.totalCertificates).toBe(0);
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      causalRecall.updateConfig({
        alpha: 0.9,
        beta: 0.05,
      });

      expect(() => causalRecall.updateConfig({})).not.toThrow();
    });

    it('should partially update config', () => {
      causalRecall.updateConfig({
        minConfidence: 0.8,
      });

      expect(() => causalRecall.updateConfig({ minConfidence: 0.8 })).not.toThrow();
    });
  });

  describe('Utility Reranking', () => {
    beforeEach(async () => {
      // Insert episodes with embeddings, then add causal edges of varying uplift.
      const episodeIds: number[] = [];
      for (let i = 0; i < 10; i++) {
        const id = await insertEpisode(
          'test-session',
          `Task ${i}`,
          `Output ${i}`,
          0.8,
          Math.floor(Date.now() / 1000) + i,
          100 + i * 50,
        );
        episodeIds.push(id);

        if (i > 0) {
          await backend.query(
            `INSERT INTO causal_edges (
               from_memory_id, from_memory_type, to_memory_id, to_memory_type,
               similarity, uplift, confidence, sample_size
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, 'episode', episodeIds[i - 1], 'episode', 0.8, 0.1 * i, 0.7, 10],
          );
        }
      }
    });

    it('should incorporate causal uplift in ranking', async () => {
      const result = await causalRecall.recall(
        'query-rerank',
        'test query',
        10,
      );

      // Candidates should have uplift values
      if (result.candidates.length > 0) {
        // Not all candidates will have uplift, but if edges exist some should
        expect(result.candidates).toBeDefined();
      }
    });

    it('should respect alpha weight for similarity', async () => {
      const highAlphaRecall = new CausalRecall(backend, embedder, undefined, {
        alpha: 0.99,
        beta: 0.005,
        gamma: 0.005,
        minConfidence: 0.6,
      });

      const result = await highAlphaRecall.recall(
        'query-alpha',
        'test query',
        5,
      );

      if (result.candidates.length > 1) {
        // Results should be sorted by utility score descending
        for (let i = 1; i < result.candidates.length; i++) {
          expect(result.candidates[i - 1].utilityScore).toBeGreaterThanOrEqual(result.candidates[i].utilityScore);
        }
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty database gracefully', async () => {
      // Postgres-substrate behavior change (ADR-0170 Phase B.5):
      // `recall_certificates.redundancy_ratio` is `REAL` (nullable, no
      // CHECK) under the new schema — was `REAL NOT NULL` in the SQLite
      // era. With no episodes inserted, redundancy_ratio = 0/0 = NaN
      // inserts cleanly rather than tripping a NOT NULL constraint. The
      // recall therefore resolves to an empty candidates list + a
      // (degenerate) certificate; it no longer rejects. This is the
      // intentional Wave 1a contract.
      const result = await causalRecall.recall(
        'query-empty',
        'test query',
        5,
      );
      expect(result.candidates).toHaveLength(0);
      expect(result.certificate).toBeDefined();
    });

    it('should handle very long query', async () => {
      await insertEpisode('test-session', 'Task', 'Output', 0.8, Math.floor(Date.now() / 1000), 100);

      const longQuery = 'test '.repeat(1000);
      const result = await causalRecall.recall(
        'query-long',
        longQuery,
        5,
      );

      expect(result).toBeDefined();
    });

    it('should handle special characters in query', async () => {
      await insertEpisode('test-session', 'Task', 'Output', 0.8, Math.floor(Date.now() / 1000), 100);

      const result = await causalRecall.recall(
        'query-special',
        '!@#$%^&*()_+-={}[]|\\:";\'<>?,./test',
        5,
      );

      expect(result).toBeDefined();
    });

    it('should handle unicode in query', async () => {
      await insertEpisode('test-session', 'Task', 'Output', 0.8, Math.floor(Date.now() / 1000), 100);

      const result = await causalRecall.recall(
        'query-unicode',
        'Hello World',
        5,
      );

      expect(result).toBeDefined();
    });

    it('should handle k=0 gracefully', async () => {
      // Same postgres-substrate behavioral note as 'empty database
      // gracefully': k=0 produces an empty candidates list and a
      // degenerate certificate (redundancy_ratio = NaN, which is no
      // longer NOT NULL). No rejection under the new substrate.
      const result = await causalRecall.recall(
        'query-zero',
        'test query',
        0,
      );
      expect(result.candidates).toHaveLength(0);
      expect(result.certificate).toBeDefined();
    });

    it('should handle very large k', async () => {
      for (let i = 0; i < 5; i++) {
        await insertEpisode('test-session', `Task ${i}`, `Output ${i}`, 0.8, Math.floor(Date.now() / 1000) + i, 100);
      }

      const result = await causalRecall.recall(
        'query-large-k',
        'test query',
        1000,
      );

      expect(result.candidates.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Performance', () => {
    it('should handle 100 episodes efficiently', async () => {
      for (let i = 0; i < 100; i++) {
        await insertEpisode('test-session', `Task ${i}`, `Output ${i}`, 0.8, Math.floor(Date.now() / 1000) + i, 100);
      }

      const startTime = Date.now();
      const result = await causalRecall.recall(
        'query-perf',
        'test query',
        10,
      );
      const duration = Date.now() - startTime;

      expect(result).toBeDefined();
      expect(duration).toBeLessThan(5000);
    }, 10000);

    it('should handle concurrent queries', async () => {
      for (let i = 0; i < 10; i++) {
        await insertEpisode('test-session', `Task ${i}`, `Output ${i}`, 0.8, Math.floor(Date.now() / 1000) + i, 100);
      }

      const queries = Array(10).fill(null).map((_, idx) =>
        causalRecall.recall(`query-concurrent-${idx}`, 'test query', 5),
      );

      const results = await Promise.all(queries);

      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result).toBeDefined();
      });
    });
  });
});
