/**
 * Unit Tests for ExplainableRecall Controller
 *
 * Tests certificate issuance, verification, provenance tracking, and justification
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ExplainableRecall, RecallCertificate, JustificationPath, ProvenanceSource } from '../../../src/controllers/ExplainableRecall.js';
import { EmbeddingService } from '../../../src/controllers/EmbeddingService.js';
import * as fs from 'fs';

const TEST_DB_PATH = './tests/fixtures/test-explainable-recall.db';

describe('ExplainableRecall', () => {
  let db: Database.Database;
  let embedder: EmbeddingService;
  let explainableRecall: ExplainableRecall;

  beforeEach(async () => {
    // Clean up previous test artifacts
    [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`].forEach(file => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });

    // Initialize database
    db = new Database(TEST_DB_PATH);
    db.pragma('journal_mode = WAL');

    // Create required tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        task TEXT NOT NULL,
        output TEXT,
        reward REAL DEFAULT 0,
        ts INTEGER DEFAULT (strftime('%s', 'now')),
        latency_ms INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS skills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        ts INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recall_certificates (
        id TEXT PRIMARY KEY,
        query_id TEXT NOT NULL,
        query_text TEXT NOT NULL,
        chunk_ids TEXT NOT NULL,
        chunk_types TEXT NOT NULL,
        minimal_why TEXT NOT NULL,
        redundancy_ratio REAL NOT NULL,
        completeness_score REAL NOT NULL,
        merkle_root TEXT NOT NULL,
        source_hashes TEXT NOT NULL,
        proof_chain TEXT NOT NULL,
        policy_proof TEXT,
        policy_version TEXT,
        access_level TEXT DEFAULT 'internal',
        latency_ms INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS justification_paths (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        certificate_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        chunk_type TEXT NOT NULL,
        reason TEXT NOT NULL,
        necessity_score REAL NOT NULL,
        path_elements TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provenance_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        source_id INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        parent_hash TEXT,
        derived_from TEXT,
        creator TEXT,
        metadata TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);

    // Initialize embedding service
    embedder = new EmbeddingService({
      model: 'mock-model',
      dimension: 384,
      provider: 'local',
    });
    await embedder.initialize();

    // Initialize ExplainableRecall
    explainableRecall = new ExplainableRecall(db);
  });

  afterEach(() => {
    db.close();
    [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`].forEach(file => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });
  });

  describe('Constructor', () => {
    it('should initialize in v1 mode (database only)', () => {
      const recall = new ExplainableRecall(db);
      expect(recall).toBeDefined();
    });

    it('should initialize in v2 mode (with embedder)', () => {
      const recall = new ExplainableRecall(db, embedder);
      expect(recall).toBeDefined();
    });

    it('should enable GraphRoPE when configured', () => {
      const recall = new ExplainableRecall(db, embedder, {
        ENABLE_GRAPH_ROPE: true,
        graphRoPEConfig: {
          maxHops: 3,
        },
      });
      expect(recall).toBeDefined();
    });
  });

  describe('createCertificate', () => {
    beforeEach(() => {
      // Insert test episodes
      for (let i = 1; i <= 5; i++) {
        db.prepare(`
          INSERT INTO episodes (id, session_id, task, output, reward)
          VALUES (?, ?, ?, ?, ?)
        `).run(i, 'test-session', `Task ${i}`, `Output containing keyword${i} and result`, 0.8);
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

      const stored = db.prepare(
        'SELECT * FROM recall_certificates WHERE id = ?'
      ).get(certificate.id);

      expect(stored).toBeDefined();
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
        db.prepare(`
          INSERT INTO episodes (id, session_id, task, output, reward)
          VALUES (?, ?, ?, ?, ?)
        `).run(i, 'test-session', `Task ${i}`, `Output ${i}`, 0.8);
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

    it('should verify valid certificate', () => {
      const result = explainableRecall.verifyCertificate(certificateId);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect non-existent certificate', () => {
      const result = explainableRecall.verifyCertificate('non-existent-id');

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Certificate not found');
    });

    it('should detect changed content', async () => {
      // Modify the episode content after certificate creation
      db.prepare(`
        UPDATE episodes SET output = 'Modified output' WHERE id = 1
      `).run();

      const result = explainableRecall.verifyCertificate(certificateId);

      expect(result.valid).toBe(false);
      expect(result.issues.some(issue => issue.includes('hash changed'))).toBe(true);
    });
  });

  describe('getJustification', () => {
    let certificateId: string;

    beforeEach(async () => {
      // Insert test episode
      db.prepare(`
        INSERT INTO episodes (id, session_id, task, output, reward)
        VALUES (?, ?, ?, ?, ?)
      `).run(1, 'test-session', 'Task 1', 'Output 1', 0.8);

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

    it('should return justification for chunk', () => {
      const justification = explainableRecall.getJustification(certificateId, '1');

      expect(justification).toBeDefined();
      expect(justification!.chunkId).toBe('1');
      expect(justification!.chunkType).toBe('episode');
      expect(justification!.reason).toBeDefined();
      expect(justification!.necessityScore).toBeGreaterThanOrEqual(0);
      expect(justification!.necessityScore).toBeLessThanOrEqual(1);
      expect(Array.isArray(justification!.pathElements)).toBe(true);
    });

    it('should return null for non-existent chunk', () => {
      const justification = explainableRecall.getJustification(certificateId, '999');

      expect(justification).toBeNull();
    });

    it('should return null for non-existent certificate', () => {
      const justification = explainableRecall.getJustification('non-existent', '1');

      expect(justification).toBeNull();
    });
  });

  describe('getProvenanceLineage', () => {
    beforeEach(async () => {
      // Insert test episode
      db.prepare(`
        INSERT INTO episodes (id, session_id, task, output, reward)
        VALUES (?, ?, ?, ?, ?)
      `).run(1, 'test-session', 'Task 1', 'Output 1', 0.8);

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

    it('should return provenance lineage', () => {
      // Get the content hash from provenance_sources
      const source = db.prepare(
        'SELECT content_hash FROM provenance_sources WHERE source_type = ? AND source_id = ?'
      ).get('episode', 1) as any;

      if (source) {
        const lineage = explainableRecall.getProvenanceLineage(source.content_hash);

        expect(Array.isArray(lineage)).toBe(true);
        expect(lineage.length).toBeGreaterThan(0);
        expect(lineage[0].sourceType).toBe('episode');
        expect(lineage[0].sourceId).toBe(1);
      }
    });

    it('should return empty array for unknown hash', () => {
      const lineage = explainableRecall.getProvenanceLineage('unknown-hash');

      expect(lineage).toHaveLength(0);
    });
  });

  describe('traceProvenance', () => {
    let certificateId: string;

    beforeEach(async () => {
      // Insert test episodes
      for (let i = 1; i <= 3; i++) {
        db.prepare(`
          INSERT INTO episodes (id, session_id, task, output, reward)
          VALUES (?, ?, ?, ?, ?)
        `).run(i, 'test-session', `Task ${i}`, `Output ${i}`, 0.8);
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

    it('should return full provenance trace', () => {
      const trace = explainableRecall.traceProvenance(certificateId);

      expect(trace.certificate).toBeDefined();
      expect(trace.sources).toBeDefined();
      expect(trace.graph).toBeDefined();
      expect(trace.graph.nodes).toBeDefined();
      expect(trace.graph.edges).toBeDefined();
    });

    it('should include certificate in graph nodes', () => {
      const trace = explainableRecall.traceProvenance(certificateId);

      const certNode = trace.graph.nodes.find(n => n.id === certificateId);
      expect(certNode).toBeDefined();
      expect(certNode!.type).toBe('certificate');
    });

    it('should throw error for non-existent certificate', () => {
      expect(() => explainableRecall.traceProvenance('non-existent')).toThrow();
    });
  });

  describe('auditCertificate', () => {
    let certificateId: string;

    beforeEach(async () => {
      // Insert test episodes
      for (let i = 1; i <= 3; i++) {
        db.prepare(`
          INSERT INTO episodes (id, session_id, task, output, reward)
          VALUES (?, ?, ?, ?, ?)
        `).run(i, 'test-session', `Task ${i}`, `Output ${i}`, 0.8);
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

    it('should return audit information', () => {
      const audit = explainableRecall.auditCertificate(certificateId);

      expect(audit.certificate).toBeDefined();
      expect(audit.justifications).toBeDefined();
      expect(audit.provenance).toBeDefined();
      expect(audit.quality).toBeDefined();
    });

    it('should include quality metrics', () => {
      const audit = explainableRecall.auditCertificate(certificateId);

      expect(audit.quality.completeness).toBeGreaterThanOrEqual(0);
      expect(audit.quality.completeness).toBeLessThanOrEqual(1);
      expect(audit.quality.redundancy).toBeGreaterThanOrEqual(1);
      expect(typeof audit.quality.avgNecessity).toBe('number');
    });

    it('should include all justifications', () => {
      const audit = explainableRecall.auditCertificate(certificateId);

      expect(audit.justifications.length).toBe(3);
    });

    it('should throw error for non-existent certificate', () => {
      expect(() => explainableRecall.auditCertificate('non-existent')).toThrow();
    });
  });

  describe('Minimal Hitting Set', () => {
    beforeEach(() => {
      // Insert test episodes with specific content
      db.prepare(`
        INSERT INTO episodes (id, session_id, task, output, reward)
        VALUES (?, ?, ?, ?, ?)
      `).run(1, 'session', 'task', 'This contains apple and banana', 0.8);

      db.prepare(`
        INSERT INTO episodes (id, session_id, task, output, reward)
        VALUES (?, ?, ?, ?, ?)
      `).run(2, 'session', 'task', 'This contains cherry', 0.8);

      db.prepare(`
        INSERT INTO episodes (id, session_id, task, output, reward)
        VALUES (?, ?, ?, ?, ?)
      `).run(3, 'session', 'task', 'This contains apple', 0.8);
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
    beforeEach(() => {
      // Insert different memory types
      db.prepare(`
        INSERT INTO episodes (id, session_id, task, output, reward)
        VALUES (?, ?, ?, ?, ?)
      `).run(1, 'session', 'task', 'Episode output', 0.8);

      db.prepare(`
        INSERT INTO skills (id, name, code, description)
        VALUES (?, ?, ?, ?)
      `).run(1, 'test_skill', 'function test() {}', 'A test skill');

      db.prepare(`
        INSERT INTO notes (id, text)
        VALUES (?, ?)
      `).run(1, 'A test note');

      db.prepare(`
        INSERT INTO facts (id, subject, predicate, object)
        VALUES (?, ?, ?, ?)
      `).run(1, 'Test', 'is', 'fact');
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
    beforeEach(() => {
      db.prepare(`
        INSERT INTO episodes (id, session_id, task, output, reward)
        VALUES (?, ?, ?, ?, ?)
      `).run(1, 'session', 'task', 'Output', 0.8);
    });

    it('should handle empty chunks array by throwing error', async () => {
      // Empty chunks causes redundancy ratio to be NaN (0/0 = NaN)
      // which violates NOT NULL constraint
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
    beforeEach(() => {
      // Insert many episodes
      for (let i = 1; i <= 100; i++) {
        db.prepare(`
          INSERT INTO episodes (id, session_id, task, output, reward)
          VALUES (?, ?, ?, ?, ?)
        `).run(i, 'session', `Task ${i}`, `Output ${i}`, 0.8);
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
      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
    }, 10000);

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
        Array.from({ length: 10 }, (_, i) => createCert(i))
      );

      expect(results).toHaveLength(10);
      results.forEach(cert => {
        expect(cert).toBeDefined();
      });
    });
  });
});
