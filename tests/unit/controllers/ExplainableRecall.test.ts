/**
 * Unit Tests for ExplainableRecall Controller
 *
 * Tests certificate issuance, verification, provenance tracking, and justification.
 *
 * ADR-0170 Phase B.5: ported from better-sqlite3 (sync) to PostgresBackend
 * (pglite-embedded, async). Each test gets a fresh ephemeral pglite cluster
 * under `os.tmpdir()`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExplainableRecall } from '../../../src/controllers/ExplainableRecall.js';
import { EmbeddingService } from '../../../src/controllers/EmbeddingService.js';
import { PostgresBackend } from '../../../src/backends/postgres/PostgresBackend.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('ExplainableRecall', () => {
  let backend: PostgresBackend;
  let dataDir: string;
  let embedder: EmbeddingService;
  let explainableRecall: ExplainableRecall;

  beforeEach(async () => {
    // ADR-0076 A4: reset the dual-instance guard so each test gets a fresh
    // controller singleton tied to this test's pglite cluster.
    ExplainableRecall._resetSingleton();

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdb-explainable-test-'));
    backend = new PostgresBackend({ metric: 'cosine', dataDir });
    await backend.initialize();

    // Load schemas (postgres dialect) for episodes/skills/notes/facts/recall_certificates/etc.
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

    explainableRecall = new ExplainableRecall(backend);
    await explainableRecall.initialize();
  });

  afterEach(async () => {
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

  describe('Constructor', () => {
    it('should initialize in v1 mode (database only)', async () => {
      ExplainableRecall._resetSingleton();
      const recall = new ExplainableRecall(backend);
      await recall.initialize();
      expect(recall).toBeDefined();
    });

    it('should initialize in v2 mode (with embedder)', async () => {
      ExplainableRecall._resetSingleton();
      const recall = new ExplainableRecall(backend, embedder);
      await recall.initialize();
      expect(recall).toBeDefined();
    });

    it('should enable GraphRoPE when configured', async () => {
      ExplainableRecall._resetSingleton();
      const recall = new ExplainableRecall(backend, embedder, {
        ENABLE_GRAPH_ROPE: true,
        graphRoPEConfig: {
          maxHops: 3,
        },
      });
      await recall.initialize();
      expect(recall).toBeDefined();
    });
  });

  describe('createCertificate', () => {
    beforeEach(async () => {
      // Insert test episodes
      for (let i = 1; i <= 5; i++) {
        await backend.query(`
          INSERT INTO episodes (id, session_id, task, output, reward)
          VALUES ($1, $2, $3, $4, $5)
        `, [i, 'test-session', `Task ${i}`, `Output containing keyword${i} and result`, 0.8]);
      }
    });

    it('should create a certificate with valid structure', async () => {
      const chunks = [
        { id: '1', type: 'episode', content: 'Output containing keyword1', relevance: 0.9 },
        { id: '2', type: 'episode', content: 'Output containing keyword2', relevance: 0.8 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-1',
        queryText: 'test query',
        chunks,
        requirements: ['keyword1', 'keyword2'],
      });

      expect(certificate.id).toBeDefined();
      expect(certificate.queryId).toBe('query-1');
      expect(certificate.queryText).toBe('test query');
      expect(certificate.chunkIds).toHaveLength(2);
      expect(certificate.chunkTypes).toHaveLength(2);
      expect(certificate.merkleRoot).toBeDefined();
      expect(certificate.sourceHashes).toHaveLength(2);
    });

    it('should calculate redundancy ratio', async () => {
      const chunks = [
        { id: '1', type: 'episode', content: 'Output with keyword1 and keyword2', relevance: 0.95 },
        { id: '2', type: 'episode', content: 'Extra output', relevance: 0.5 },
        { id: '3', type: 'episode', content: 'More extra output', relevance: 0.4 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-2',
        queryText: 'test query',
        chunks,
        requirements: ['keyword1'],
      });

      expect(certificate.redundancyRatio).toBeGreaterThan(0);
      expect(certificate.redundancyRatio).toBe(chunks.length / certificate.minimalWhy.length);
    });

    it('should calculate completeness score', async () => {
      const chunks = [
        { id: '1', type: 'episode', content: 'Output with keyword1', relevance: 0.9 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-3',
        queryText: 'test query',
        chunks,
        requirements: ['keyword1', 'missing_keyword'],
      });

      expect(certificate.completenessScore).toBeGreaterThanOrEqual(0);
      expect(certificate.completenessScore).toBeLessThanOrEqual(1);
    });

    it('should set access level', async () => {
      const chunks = [
        { id: '1', type: 'episode', content: 'Output', relevance: 0.9 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-4',
        queryText: 'test query',
        chunks,
        requirements: [],
        accessLevel: 'confidential',
      });

      expect(certificate.accessLevel).toBe('confidential');
    });

    it('should generate Merkle proof chain', async () => {
      const chunks = [
        { id: '1', type: 'episode', content: 'Output 1', relevance: 0.9 },
        { id: '2', type: 'episode', content: 'Output 2', relevance: 0.8 },
        { id: '3', type: 'episode', content: 'Output 3', relevance: 0.7 },
        { id: '4', type: 'episode', content: 'Output 4', relevance: 0.6 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-5',
        queryText: 'test query',
        chunks,
        requirements: [],
      });

      expect(certificate.proofChain).toBeDefined();
      expect(Array.isArray(certificate.proofChain)).toBe(true);
    });

    it('should store certificate in database', async () => {
      const chunks = [
        { id: '1', type: 'episode', content: 'Output', relevance: 0.9 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-6',
        queryText: 'test query',
        chunks,
        requirements: [],
      });

      const result = await backend.query(
        'SELECT * FROM recall_certificates WHERE id = $1',
        [certificate.id],
      );

      expect(result.rows[0]).toBeDefined();
    });

    it('should record latency', async () => {
      const chunks = [
        { id: '1', type: 'episode', content: 'Output', relevance: 0.9 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-7',
        queryText: 'test query',
        chunks,
        requirements: [],
      });

      expect(certificate.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('verifyCertificate', () => {
    let certificateId: string;

    beforeEach(async () => {
      // Insert test episodes
      for (let i = 1; i <= 3; i++) {
        await backend.query(`
          INSERT INTO episodes (id, session_id, task, output, reward)
          VALUES ($1, $2, $3, $4, $5)
        `, [i, 'test-session', `Task ${i}`, `Output ${i}`, 0.8]);
      }

      // Create a certificate
      const chunks = [
        { id: '1', type: 'episode', content: 'Output 1', relevance: 0.9 },
        { id: '2', type: 'episode', content: 'Output 2', relevance: 0.8 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-verify',
        queryText: 'verification test',
        chunks,
        requirements: ['output'],
      });

      certificateId = certificate.id;
    });

    it('should verify valid certificate', async () => {
      const result = await explainableRecall.verifyCertificate(certificateId);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect non-existent certificate', async () => {
      const result = await explainableRecall.verifyCertificate('non-existent-id');

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Certificate not found');
    });

    it('should detect changed content', async () => {
      // Modify the episode content after certificate creation
      await backend.query(
        `UPDATE episodes SET output = $1 WHERE id = $2`,
        ['Modified output', 1],
      );

      const result = await explainableRecall.verifyCertificate(certificateId);

      expect(result.valid).toBe(false);
      expect(result.issues.some(issue => issue.includes('hash changed'))).toBe(true);
    });
  });

  describe('getJustification', () => {
    let certificateId: string;

    beforeEach(async () => {
      // Insert test episode
      await backend.query(`
        INSERT INTO episodes (id, session_id, task, output, reward)
        VALUES ($1, $2, $3, $4, $5)
      `, [1, 'test-session', 'Task 1', 'Output 1', 0.8]);

      // Create certificate
      const chunks = [
        { id: '1', type: 'episode', content: 'Output 1', relevance: 0.9 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-just',
        queryText: 'justification test',
        chunks,
        requirements: [],
      });

      certificateId = certificate.id;
    });

    it('should return justification for chunk', async () => {
      const justification = await explainableRecall.getJustification(certificateId, '1');

      expect(justification).toBeDefined();
      expect(justification!.chunkId).toBe('1');
      expect(justification!.chunkType).toBe('episode');
      expect(justification!.reason).toBeDefined();
      expect(justification!.necessityScore).toBeGreaterThanOrEqual(0);
      expect(justification!.necessityScore).toBeLessThanOrEqual(1);
      expect(Array.isArray(justification!.pathElements)).toBe(true);
    });

    it('should return null for non-existent chunk', async () => {
      const justification = await explainableRecall.getJustification(certificateId, '999');

      expect(justification).toBeNull();
    });

    it('should return null for non-existent certificate', async () => {
      const justification = await explainableRecall.getJustification('non-existent', '1');

      expect(justification).toBeNull();
    });
  });

  describe('getProvenanceLineage', () => {
    beforeEach(async () => {
      // Insert test episode
      await backend.query(`
        INSERT INTO episodes (id, session_id, task, output, reward)
        VALUES ($1, $2, $3, $4, $5)
      `, [1, 'test-session', 'Task 1', 'Output 1', 0.8]);

      // Create certificate to trigger provenance creation
      const chunks = [
        { id: '1', type: 'episode', content: 'Output 1', relevance: 0.9 },
      ];

      await explainableRecall.createCertificate({
        queryId: 'query-prov',
        queryText: 'provenance test',
        chunks,
        requirements: [],
      });
    });

    it('should return provenance lineage', async () => {
      // Get the content hash from provenance_sources
      const sourceResult = await backend.query(
        'SELECT content_hash FROM provenance_sources WHERE source_type = $1 AND source_id = $2',
        ['episode', 1],
      );
      const source = sourceResult.rows[0] as any;

      if (source) {
        const lineage = await explainableRecall.getProvenanceLineage(source.content_hash);

        expect(Array.isArray(lineage)).toBe(true);
        expect(lineage.length).toBeGreaterThan(0);
        expect(lineage[0].sourceType).toBe('episode');
        // BIGINT may surface as either number or string depending on driver
        // normalization (pglite normalizes small values to number, pg may
        // return string). Compare via Number() for portability.
        expect(Number(lineage[0].sourceId)).toBe(1);
      }
    });

    it('should return empty array for unknown hash', async () => {
      const lineage = await explainableRecall.getProvenanceLineage('unknown-hash');

      expect(lineage).toHaveLength(0);
    });
  });

  describe('traceProvenance', () => {
    let certificateId: string;

    beforeEach(async () => {
      // Insert test episodes
      for (let i = 1; i <= 3; i++) {
        await backend.query(`
          INSERT INTO episodes (id, session_id, task, output, reward)
          VALUES ($1, $2, $3, $4, $5)
        `, [i, 'test-session', `Task ${i}`, `Output ${i}`, 0.8]);
      }

      // Create certificate
      const chunks = [
        { id: '1', type: 'episode', content: 'Output 1', relevance: 0.9 },
        { id: '2', type: 'episode', content: 'Output 2', relevance: 0.8 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-trace',
        queryText: 'trace test',
        chunks,
        requirements: [],
      });

      certificateId = certificate.id;
    });

    it('should return full provenance trace', async () => {
      const trace = await explainableRecall.traceProvenance(certificateId);

      expect(trace.certificate).toBeDefined();
      expect(trace.sources).toBeDefined();
      expect(trace.graph).toBeDefined();
      expect(trace.graph.nodes).toBeDefined();
      expect(trace.graph.edges).toBeDefined();
    });

    it('should include certificate in graph nodes', async () => {
      const trace = await explainableRecall.traceProvenance(certificateId);

      const certNode = trace.graph.nodes.find(n => n.id === certificateId);
      expect(certNode).toBeDefined();
      expect(certNode!.type).toBe('certificate');
    });

    it('should throw error for non-existent certificate', async () => {
      await expect(explainableRecall.traceProvenance('non-existent')).rejects.toThrow();
    });
  });

  describe('auditCertificate', () => {
    let certificateId: string;

    beforeEach(async () => {
      // Insert test episodes
      for (let i = 1; i <= 3; i++) {
        await backend.query(`
          INSERT INTO episodes (id, session_id, task, output, reward)
          VALUES ($1, $2, $3, $4, $5)
        `, [i, 'test-session', `Task ${i}`, `Output ${i}`, 0.8]);
      }

      // Create certificate
      const chunks = [
        { id: '1', type: 'episode', content: 'Output 1', relevance: 0.9 },
        { id: '2', type: 'episode', content: 'Output 2', relevance: 0.8 },
        { id: '3', type: 'episode', content: 'Output 3', relevance: 0.7 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-audit',
        queryText: 'audit test',
        chunks,
        requirements: ['output'],
      });

      certificateId = certificate.id;
    });

    it('should return audit information', async () => {
      const audit = await explainableRecall.auditCertificate(certificateId);

      expect(audit.certificate).toBeDefined();
      expect(audit.justifications).toBeDefined();
      expect(audit.provenance).toBeDefined();
      expect(audit.quality).toBeDefined();
    });

    it('should include quality metrics', async () => {
      const audit = await explainableRecall.auditCertificate(certificateId);

      expect(audit.quality.completeness).toBeGreaterThanOrEqual(0);
      expect(audit.quality.completeness).toBeLessThanOrEqual(1);
      expect(audit.quality.redundancy).toBeGreaterThanOrEqual(1);
      expect(typeof audit.quality.avgNecessity).toBe('number');
    });

    it('should include all justifications', async () => {
      const audit = await explainableRecall.auditCertificate(certificateId);

      expect(audit.justifications.length).toBe(3);
    });

    it('should throw error for non-existent certificate', async () => {
      await expect(explainableRecall.auditCertificate('non-existent')).rejects.toThrow();
    });
  });

  describe('Minimal Hitting Set', () => {
    beforeEach(async () => {
      // Insert test episodes with specific content
      await backend.query(`
        INSERT INTO episodes (id, session_id, task, output, reward)
        VALUES ($1, $2, $3, $4, $5)
      `, [1, 'session', 'task', 'This contains apple and banana', 0.8]);

      await backend.query(`
        INSERT INTO episodes (id, session_id, task, output, reward)
        VALUES ($1, $2, $3, $4, $5)
      `, [2, 'session', 'task', 'This contains cherry', 0.8]);

      await backend.query(`
        INSERT INTO episodes (id, session_id, task, output, reward)
        VALUES ($1, $2, $3, $4, $5)
      `, [3, 'session', 'task', 'This contains apple', 0.8]);
    });

    it('should compute minimal hitting set', async () => {
      const chunks = [
        { id: '1', type: 'episode', content: 'This contains apple and banana', relevance: 0.9 },
        { id: '2', type: 'episode', content: 'This contains cherry', relevance: 0.8 },
        { id: '3', type: 'episode', content: 'This contains apple', relevance: 0.7 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-mhs',
        queryText: 'test query',
        chunks,
        requirements: ['apple', 'banana', 'cherry'],
      });

      // Minimal hitting set should cover all requirements with minimum chunks
      expect(certificate.minimalWhy.length).toBeLessThanOrEqual(chunks.length);
    });

    it('should handle empty requirements', async () => {
      const chunks = [
        { id: '1', type: 'episode', content: 'Output', relevance: 0.9 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-empty-req',
        queryText: 'test query',
        chunks,
        requirements: [],
      });

      expect(certificate.minimalWhy.length).toBeGreaterThan(0);
    });
  });

  describe('Different Memory Types', () => {
    beforeEach(async () => {
      // Insert different memory types
      await backend.query(`
        INSERT INTO episodes (id, session_id, task, output, reward)
        VALUES ($1, $2, $3, $4, $5)
      `, [1, 'session', 'task', 'Episode output', 0.8]);

      await backend.query(`
        INSERT INTO skills (id, name, code, description)
        VALUES ($1, $2, $3, $4)
      `, [1, 'test_skill', 'function test() {}', 'A test skill']);

      await backend.query(`
        INSERT INTO notes (id, text)
        VALUES ($1, $2)
      `, [1, 'A test note']);

      await backend.query(`
        INSERT INTO facts (id, subject, predicate, object)
        VALUES ($1, $2, $3, $4)
      `, [1, 'Test', 'is', 'fact']);
    });

    it('should handle episode type', async () => {
      const chunks = [
        { id: '1', type: 'episode', content: 'Episode output', relevance: 0.9 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-episode',
        queryText: 'test',
        chunks,
        requirements: [],
      });

      expect(certificate.chunkTypes).toContain('episode');
    });

    it('should handle skill type', async () => {
      const chunks = [
        { id: '1', type: 'skill', content: 'test_skill function', relevance: 0.9 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-skill',
        queryText: 'test',
        chunks,
        requirements: [],
      });

      expect(certificate.chunkTypes).toContain('skill');
    });

    it('should handle note type', async () => {
      const chunks = [
        { id: '1', type: 'note', content: 'A test note', relevance: 0.9 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-note',
        queryText: 'test',
        chunks,
        requirements: [],
      });

      expect(certificate.chunkTypes).toContain('note');
    });

    it('should handle fact type', async () => {
      const chunks = [
        { id: '1', type: 'fact', content: 'Test is fact', relevance: 0.9 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-fact',
        queryText: 'test',
        chunks,
        requirements: [],
      });

      expect(certificate.chunkTypes).toContain('fact');
    });

    it('should handle mixed types', async () => {
      const chunks = [
        { id: '1', type: 'episode', content: 'Episode output', relevance: 0.9 },
        { id: '1', type: 'skill', content: 'Skill code', relevance: 0.8 },
        { id: '1', type: 'note', content: 'Note text', relevance: 0.7 },
        { id: '1', type: 'fact', content: 'Fact triple', relevance: 0.6 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-mixed',
        queryText: 'test',
        chunks,
        requirements: [],
      });

      expect(certificate.chunkTypes).toContain('episode');
      expect(certificate.chunkTypes).toContain('skill');
      expect(certificate.chunkTypes).toContain('note');
      expect(certificate.chunkTypes).toContain('fact');
    });
  });

  describe('Edge Cases', () => {
    beforeEach(async () => {
      await backend.query(`
        INSERT INTO episodes (id, session_id, task, output, reward)
        VALUES ($1, $2, $3, $4, $5)
      `, [1, 'session', 'task', 'Output', 0.8]);
    });

    it('should handle empty chunks array by throwing error', async () => {
      // Empty chunks causes redundancy ratio to be NaN (0/0 = NaN);
      // postgres rejects NaN for REAL columns just as sqlite did, so the
      // assertion contract is preserved.
      await expect(explainableRecall.createCertificate({
        queryId: 'query-empty',
        queryText: 'test',
        chunks: [],
        requirements: [],
      })).rejects.toThrow();
    });

    it('should handle very long query text', async () => {
      const chunks = [
        { id: '1', type: 'episode', content: 'Output', relevance: 0.9 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-long',
        queryText: 'a'.repeat(10000),
        chunks,
        requirements: [],
      });

      expect(certificate).toBeDefined();
    });

    it('should handle special characters in requirements', async () => {
      const chunks = [
        { id: '1', type: 'episode', content: 'Output with !@#$%', relevance: 0.9 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-special',
        queryText: 'test',
        chunks,
        requirements: ['!@#$%', '<script>', 'SELECT *'],
      });

      expect(certificate).toBeDefined();
    });

    it('should handle unicode in content', async () => {
      const chunks = [
        { id: '1', type: 'episode', content: 'Output', relevance: 0.9 },
      ];

      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-unicode',
        queryText: 'test',
        chunks,
        requirements: [],
      });

      expect(certificate).toBeDefined();
    });
  });

  describe('Performance', () => {
    beforeEach(async () => {
      // Insert many episodes
      for (let i = 1; i <= 100; i++) {
        await backend.query(`
          INSERT INTO episodes (id, session_id, task, output, reward)
          VALUES ($1, $2, $3, $4, $5)
        `, [i, 'session', `Task ${i}`, `Output ${i}`, 0.8]);
      }
    });

    it('should handle many chunks efficiently', async () => {
      const chunks = Array.from({ length: 50 }, (_, i) => ({
        id: String(i + 1),
        type: 'episode' as const,
        content: `Output ${i + 1}`,
        relevance: 0.9 - i * 0.01,
      }));

      const startTime = Date.now();
      const certificate = await explainableRecall.createCertificate({
        queryId: 'query-perf',
        queryText: 'test',
        chunks,
        requirements: Array.from({ length: 10 }, (_, i) => `Output ${i + 1}`),
      });
      const duration = Date.now() - startTime;

      expect(certificate).toBeDefined();
      // pglite is slower than better-sqlite3 per-query; raise from 5s → 15s
      expect(duration).toBeLessThan(15000);
    }, 30000);

    it('should handle concurrent certificate creation', async () => {
      const createCert = (idx: number) =>
        explainableRecall.createCertificate({
          queryId: `query-concurrent-${idx}`,
          queryText: `test ${idx}`,
          chunks: [
            { id: String(idx + 1), type: 'episode', content: `Output ${idx + 1}`, relevance: 0.9 },
          ],
          requirements: [],
        });

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => createCert(i)),
      );

      expect(results).toHaveLength(10);
      results.forEach(cert => {
        expect(cert).toBeDefined();
      });
    });
  });
});
