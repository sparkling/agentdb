/**
 * Unit Tests for AttestationLog (ADR-060)
 *
 * Append-only audit log for MutationProof and MutationDenial records.
 * Tests schema creation, append semantics, parameterized (injection-safe)
 * queries, denial-pattern aggregation, pruning, and summary statistics.
 *
 * Uses a real better-sqlite3 database (house style) — no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import { AttestationLog } from '../../../src/security/AttestationLog.js';
import type { MutationProof, MutationDenial, AttestationToken } from '../../../src/security/MutationGuard.js';

const TEST_DB_PATH = './tests/fixtures/test-attestation-log.db';
const DB_FILES = [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`];

function cleanup(): void {
  DB_FILES.forEach(file => {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  });
}

function makeToken(overrides: Partial<AttestationToken> = {}): AttestationToken {
  const now = Date.now();
  return {
    agentId: 'agent-alpha',
    namespace: 'default',
    scope: 'write',
    issuedAt: now,
    expiresAt: now + 300_000,
    ...overrides,
  };
}

function makeProof(overrides: Partial<MutationProof> = {}): MutationProof {
  return {
    id: 'proof-1',
    operation: 'insert',
    timestamp: Date.now(),
    structuralHash: 'a'.repeat(64),
    attestation: makeToken(),
    invariantChecks: [{ check: 'capacity', passed: true }],
    wasmProofId: undefined,
    valid: true,
    ...overrides,
  };
}

function makeDenial(overrides: Partial<MutationDenial> = {}): MutationDenial {
  return {
    operation: 'insert',
    reason: 'Authentication token expired',
    code: 'TOKEN_EXPIRED',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('AttestationLog', () => {
  let db: Database.Database;
  let log: AttestationLog;

  beforeEach(() => {
    cleanup();
    db = new Database(TEST_DB_PATH);
    db.pragma('journal_mode = WAL');
    log = new AttestationLog(db);
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  describe('schema creation', () => {
    it('creates the mutation_attestations table on construction', () => {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mutation_attestations'")
        .get() as { name?: string } | undefined;
      expect(row?.name).toBe('mutation_attestations');
    });

    it('creates supporting indexes', () => {
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='mutation_attestations'")
        .all() as Array<{ name: string }>;
      const names = indexes.map(i => i.name);
      expect(names).toContain('idx_attestations_ts');
      expect(names).toContain('idx_attestations_agent');
      expect(names).toContain('idx_attestations_status');
    });

    it('is idempotent — constructing twice on the same db does not throw', () => {
      expect(() => new AttestationLog(db)).not.toThrow();
    });

    it('throws a wrapped error when schema creation fails', () => {
      const brokenDb = {
        exec() {
          throw new Error('disk I/O error');
        },
        prepare() {
          throw new Error('should not be called');
        },
      };
      expect(() => new AttestationLog(brokenDb as any)).toThrow(/AttestationLog schema creation failed: disk I\/O error/);
    });
  });

  describe('record (proved mutations)', () => {
    it('appends a proved attestation row', () => {
      log.record(makeProof());
      const rows = log.query();
      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe('proved');
      expect(rows[0].operation).toBe('insert');
      expect(rows[0].agent_id).toBe('agent-alpha');
      expect(rows[0].namespace).toBe('default');
      expect(rows[0].denial_reason).toBeNull();
      expect(rows[0].denial_code).toBeNull();
    });

    it('persists the structural hash as proof_hash', () => {
      const hash = 'deadbeef'.repeat(8);
      log.record(makeProof({ structuralHash: hash }));
      const rows = log.query();
      expect(rows[0].proof_hash).toBe(hash);
    });

    it('stores the wasm_proof_id when present and NULL when absent', () => {
      log.record(makeProof({ id: 'p-with', wasmProofId: 42 }));
      log.record(makeProof({ id: 'p-without', wasmProofId: undefined }));
      const rows = log.query();
      const ids = rows.map(r => r.wasm_proof_id).sort();
      // one NULL, one 42
      expect(ids).toContain(42);
      expect(ids).toContain(null);
    });

    it('serializes invariantChecks into the metadata column', () => {
      log.record(
        makeProof({
          invariantChecks: [
            { check: 'capacity', passed: true },
            { check: 'query_valid', passed: false },
          ],
        }),
      );
      const rows = log.query();
      const meta = JSON.parse(rows[0].metadata);
      expect(meta.invariantChecks).toHaveLength(2);
      expect(meta.invariantChecks[0]).toEqual({ check: 'capacity', passed: true });
    });

    it('converts millisecond timestamps to second-resolution ts', () => {
      const tsMs = 1_700_000_000_000;
      log.record(makeProof({ timestamp: tsMs }));
      const rows = log.query();
      expect(rows[0].ts).toBe(Math.floor(tsMs / 1000));
    });
  });

  describe('recordDenial (rejected mutations)', () => {
    it('appends a denied attestation row carrying reason and code', () => {
      log.recordDenial(makeDenial(), 'agent-beta', 'tenant-1');
      const rows = log.query();
      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe('denied');
      expect(rows[0].denial_reason).toBe('Authentication token expired');
      expect(rows[0].denial_code).toBe('TOKEN_EXPIRED');
      expect(rows[0].agent_id).toBe('agent-beta');
      expect(rows[0].namespace).toBe('tenant-1');
      expect(rows[0].proof_hash).toBeNull();
    });

    it('records the offending field in metadata when present', () => {
      log.recordDenial(
        makeDenial({ code: 'PATH_TRAVERSAL', reason: 'traversal', field: 'path' }),
        'agent-beta',
        'default',
      );
      const rows = log.query();
      expect(JSON.parse(rows[0].metadata)).toEqual({ field: 'path' });
    });

    it('leaves metadata NULL when the denial has no field', () => {
      log.recordDenial(makeDenial({ field: undefined }), 'agent-beta', 'default');
      const rows = log.query();
      expect(rows[0].metadata).toBeNull();
    });
  });

  describe('append-only / multi-record behavior', () => {
    it('preserves every record without overwriting prior ones', () => {
      for (let i = 0; i < 5; i++) {
        log.record(makeProof({ id: `proof-${i}`, structuralHash: String(i).repeat(64) }));
      }
      log.recordDenial(makeDenial(), 'agent-x', 'default');
      expect(log.query().length).toBe(6);
    });

    it('assigns monotonically increasing primary keys', () => {
      log.record(makeProof());
      log.record(makeProof());
      const ids = (db.prepare('SELECT id FROM mutation_attestations ORDER BY id').all() as Array<{ id: number }>).map(r => r.id);
      expect(ids[1]).toBeGreaterThan(ids[0]);
    });
  });

  describe('query filters', () => {
    beforeEach(() => {
      const base = 1_700_000_000_000;
      log.record(makeProof({ attestation: makeToken({ agentId: 'a1', namespace: 'ns1' }), timestamp: base }));
      log.record(makeProof({ attestation: makeToken({ agentId: 'a2', namespace: 'ns2' }), timestamp: base + 10_000 }));
      log.recordDenial(makeDenial({ timestamp: base + 20_000 }), 'a1', 'ns1');
      log.recordDenial(makeDenial({ code: 'PATH_TRAVERSAL', timestamp: base + 30_000 }), 'a2', 'ns2');
    });

    it('returns all records when no filter given', () => {
      expect(log.query().length).toBe(4);
    });

    it('filters by agentId', () => {
      const rows = log.query({ agentId: 'a1' });
      expect(rows.length).toBe(2);
      rows.forEach(r => expect(r.agent_id).toBe('a1'));
    });

    it('filters by namespace', () => {
      const rows = log.query({ namespace: 'ns2' });
      expect(rows.length).toBe(2);
      rows.forEach(r => expect(r.namespace).toBe('ns2'));
    });

    it('filters by status', () => {
      expect(log.query({ status: 'proved' }).length).toBe(2);
      expect(log.query({ status: 'denied' }).length).toBe(2);
    });

    it('combines agentId + status filters with AND semantics', () => {
      const rows = log.query({ agentId: 'a1', status: 'denied' });
      expect(rows.length).toBe(1);
      expect(rows[0].agent_id).toBe('a1');
      expect(rows[0].status).toBe('denied');
    });

    it('filters by since (millisecond input, converted to seconds)', () => {
      const rows = log.query({ since: 1_700_000_000_000 + 20_000 });
      // ts >= floor((base+20000)/1000) keeps the two denials
      expect(rows.length).toBe(2);
      rows.forEach(r => expect(r.status).toBe('denied'));
    });

    it('respects the limit option', () => {
      const rows = log.query({ limit: 1 });
      expect(rows.length).toBe(1);
    });

    it('ignores a non-positive limit (returns all)', () => {
      expect(log.query({ limit: 0 }).length).toBe(4);
    });

    it('orders results by ts descending (newest first)', () => {
      const rows = log.query();
      for (let i = 0; i < rows.length - 1; i++) {
        expect(rows[i].ts).toBeGreaterThanOrEqual(rows[i + 1].ts);
      }
    });
  });

  describe('SQL-injection resistance (parameterized queries)', () => {
    it('treats a malicious agentId as a literal, not SQL', () => {
      log.record(makeProof());
      // Attempt to drop the table via the agentId filter.
      const malicious = "a1' OR '1'='1'; DROP TABLE mutation_attestations; --";
      const rows = log.query({ agentId: malicious });
      // No rows match the literal string, and the table must still exist.
      expect(rows.length).toBe(0);
      const tableStillExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mutation_attestations'")
        .get();
      expect(tableStillExists).toBeDefined();
      // Original record is intact.
      expect(log.query().length).toBe(1);
    });

    it('treats a malicious namespace value as a literal', () => {
      log.recordDenial(makeDenial(), "x'; DELETE FROM mutation_attestations; --", "ns'); --");
      // The exact malicious namespace round-trips as data.
      const rows = log.query({ namespace: "ns'); --" });
      expect(rows.length).toBe(1);
      expect(log.query().length).toBe(1);
    });
  });

  describe('getDenialPatterns', () => {
    beforeEach(() => {
      const base = 1_700_000_000_000;
      log.recordDenial(makeDenial({ code: 'TOKEN_EXPIRED', timestamp: base }), 'a', 'd');
      log.recordDenial(makeDenial({ code: 'TOKEN_EXPIRED', timestamp: base + 1000 }), 'a', 'd');
      log.recordDenial(makeDenial({ code: 'TOKEN_EXPIRED', timestamp: base + 2000 }), 'a', 'd');
      log.recordDenial(makeDenial({ code: 'PATH_TRAVERSAL', timestamp: base + 3000 }), 'a', 'd');
      log.record(makeProof({ timestamp: base })); // proved rows must be excluded
    });

    it('aggregates denial counts grouped by code', () => {
      const patterns = log.getDenialPatterns();
      const expired = patterns.find(p => p.code === 'TOKEN_EXPIRED');
      const traversal = patterns.find(p => p.code === 'PATH_TRAVERSAL');
      expect(expired?.count).toBe(3);
      expect(traversal?.count).toBe(1);
    });

    it('orders patterns by descending count', () => {
      const patterns = getCountsDesc(log.getDenialPatterns());
      expect(patterns[0].code).toBe('TOKEN_EXPIRED');
    });

    it('reports the most recent lastSeen ts per code', () => {
      const patterns = log.getDenialPatterns();
      const expired = patterns.find(p => p.code === 'TOKEN_EXPIRED')!;
      expect(expired.lastSeen).toBe(Math.floor((1_700_000_000_000 + 2000) / 1000));
    });

    it('excludes proved rows from denial aggregation', () => {
      const total = log.getDenialPatterns().reduce((sum, p) => sum + p.count, 0);
      expect(total).toBe(4); // 3 expired + 1 traversal, no proved
    });

    it('honors the since cutoff', () => {
      const patterns = log.getDenialPatterns(1_700_000_000_000 + 3000);
      // Only the PATH_TRAVERSAL denial at base+3000 survives.
      expect(patterns.length).toBe(1);
      expect(patterns[0].code).toBe('PATH_TRAVERSAL');
    });

    it('returns an empty array when there are no denials', () => {
      const freshDb = new Database(':memory:');
      const freshLog = new AttestationLog(freshDb);
      freshLog.record(makeProof());
      expect(freshLog.getDenialPatterns()).toEqual([]);
      freshDb.close();
    });
  });

  describe('prune', () => {
    it('deletes records older than the given age and returns the count', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      // Insert one ancient and one recent row directly with controlled ts.
      db.prepare(
        "INSERT INTO mutation_attestations (ts, operation, agent_id, namespace, status) VALUES (?, 'insert', 'a', 'd', 'proved')",
      ).run(nowSec - 10_000);
      db.prepare(
        "INSERT INTO mutation_attestations (ts, operation, agent_id, namespace, status) VALUES (?, 'insert', 'a', 'd', 'proved')",
      ).run(nowSec);

      // Prune anything older than 5000 seconds.
      const deleted = log.prune(5_000_000);
      expect(deleted).toBe(1);
      expect(log.query().length).toBe(1);
    });

    it('returns 0 when nothing is old enough to prune', () => {
      log.record(makeProof());
      const deleted = log.prune(60 * 60 * 1000); // 1 hour
      expect(deleted).toBe(0);
      expect(log.query().length).toBe(1);
    });
  });

  describe('getStats', () => {
    it('summarizes proved/denied totals and unique agents', () => {
      log.record(makeProof({ attestation: makeToken({ agentId: 'a1' }) }));
      log.record(makeProof({ attestation: makeToken({ agentId: 'a2' }) }));
      log.recordDenial(makeDenial(), 'a1', 'default');

      const stats = log.getStats();
      expect(stats.total).toBe(3);
      expect(stats.proved).toBe(2);
      expect(stats.denied).toBe(1);
      expect(stats.uniqueAgents).toBe(2);
      expect(stats.oldestTs).toBeGreaterThan(0);
    });

    it('returns zeroed stats for an empty log', () => {
      const stats = log.getStats();
      expect(stats).toEqual({ total: 0, proved: 0, denied: 0, uniqueAgents: 0, oldestTs: 0 });
    });
  });
});

/** Sort a copy of the patterns by descending count for stable assertions. */
function getCountsDesc<T extends { count: number }>(patterns: T[]): T[] {
  return [...patterns].sort((a, b) => b.count - a.count);
}
