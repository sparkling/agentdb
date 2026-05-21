/**
 * Unit Tests for GuardedVectorBackend (ADR-060)
 *
 * SECURITY-CRITICAL: GuardedVectorBackend wraps a VectorBackend so that every
 * mutating operation must clear MutationGuard before the inner backend runs.
 * A denied proof must throw ProofDeniedError and MUST NOT forward the call to
 * the inner backend. Read-only operations pass through untouched.
 *
 * These tests use a REAL in-memory VectorBackend implementation (not a mock
 * framework), a REAL MutationGuard, and a REAL AttestationLog backed by an
 * in-memory better-sqlite3 database. Assertions verify both the thrown errors
 * and that the inner backend's state was / was not mutated.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  GuardedVectorBackend,
  ProofDeniedError,
} from '../../../src/backends/ruvector/GuardedVectorBackend.js';
import { MutationGuard, type GuardConfig } from '../../../src/security/MutationGuard.js';
import { AttestationLog } from '../../../src/security/AttestationLog.js';
import type {
  VectorBackend,
  SearchResult,
  SearchOptions,
  VectorStats,
} from '../../../src/backends/VectorBackend.js';

const DIM = 8;

/**
 * A genuine in-memory VectorBackend used as the inner backend. It records how
 * many times each method ran so tests can prove the guard blocked or allowed a
 * forward call. Optional failure injection covers the backend-error path.
 */
class FakeVectorBackend implements VectorBackend {
  readonly name = 'ruvector' as const;
  readonly store = new Map<string, Float32Array>();
  readonly calls = {
    insert: 0,
    insertBatch: 0,
    search: 0,
    remove: 0,
    save: 0,
    load: 0,
    getStats: 0,
    close: 0,
  };
  failOn: Partial<Record<keyof FakeVectorBackend['calls'], string>> = {};
  closed = false;
  learning: unknown = null;

  insert(id: string, embedding: Float32Array): void {
    this.calls.insert++;
    if (this.failOn.insert) throw new Error(this.failOn.insert);
    this.store.set(id, embedding);
  }

  insertBatch(items: Array<{ id: string; embedding: Float32Array }>): void {
    this.calls.insertBatch++;
    if (this.failOn.insertBatch) throw new Error(this.failOn.insertBatch);
    for (const it of items) this.store.set(it.id, it.embedding);
  }

  search(_query: Float32Array, k: number, _options?: SearchOptions): SearchResult[] {
    this.calls.search++;
    if (this.failOn.search) throw new Error(this.failOn.search);
    return Array.from(this.store.keys())
      .slice(0, k)
      .map(id => ({ id, distance: 0.1, similarity: 0.9 }));
  }

  remove(id: string): boolean {
    this.calls.remove++;
    if (this.failOn.remove) throw new Error(this.failOn.remove);
    return this.store.delete(id);
  }

  getStats(): VectorStats {
    this.calls.getStats++;
    return {
      count: this.store.size,
      dimension: DIM,
      metric: 'cosine',
      backend: 'ruvector',
      memoryUsage: 0,
    };
  }

  async save(_path: string): Promise<void> {
    this.calls.save++;
    if (this.failOn.save) throw new Error(this.failOn.save);
  }

  async load(_path: string): Promise<void> {
    this.calls.load++;
    if (this.failOn.load) throw new Error(this.failOn.load);
  }

  close(): void {
    this.calls.close++;
    this.closed = true;
  }

  getLearning(): unknown {
    return this.learning;
  }

  setLearning(learning: unknown): void {
    this.learning = learning;
  }
}

function makeConfig(overrides: Partial<GuardConfig> = {}): GuardConfig {
  return {
    dimension: DIM,
    maxElements: 100,
    enableWasmProofs: false,
    enableAttestationLog: false,
    defaultNamespace: 'default',
    ...overrides,
  };
}

function vec(fill = 0.1, dim = DIM): Float32Array {
  return new Float32Array(dim).fill(fill);
}

describe('GuardedVectorBackend', () => {
  let db: Database.Database;
  let inner: FakeVectorBackend;
  let guard: MutationGuard;
  let log: AttestationLog;
  let backend: GuardedVectorBackend;

  beforeEach(async () => {
    db = new Database(':memory:');
    log = new AttestationLog(db);
    inner = new FakeVectorBackend();
    guard = new MutationGuard(makeConfig());
    await guard.initialize();
    backend = new GuardedVectorBackend(inner, guard, log);
  });

  afterEach(() => {
    db.close();
  });

  describe('ProofDeniedError', () => {
    it('exposes code, operation, and the full denial object', () => {
      const denial = { operation: 'insert', reason: 'nope', code: 'X', timestamp: Date.now() };
      const err = new ProofDeniedError('nope', 'X', 'insert', denial);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ProofDeniedError');
      expect(err.message).toBe('Proof denied for insert: nope');
      expect(err.code).toBe('X');
      expect(err.operation).toBe('insert');
      expect(err.denial).toBe(denial);
    });
  });

  describe('insert', () => {
    it('forwards a valid insert to the inner backend', () => {
      backend.insert('vec-1', vec());
      expect(inner.calls.insert).toBe(1);
      expect(inner.store.has('vec-1')).toBe(true);
    });

    it('records a proved attestation for a valid insert', () => {
      backend.insert('vec-1', vec());
      const proved = log.query({ status: 'proved' });
      expect(proved.length).toBe(1);
      expect(proved[0].operation).toBe('insert');
    });

    it('REJECTS an invalid insert and does NOT touch the inner backend', () => {
      expect(() => backend.insert('../traversal', vec())).toThrow(ProofDeniedError);
      expect(inner.calls.insert).toBe(0);
      expect(inner.store.size).toBe(0);
    });

    it('throws a ProofDeniedError carrying the guard denial code', () => {
      try {
        backend.insert('', vec());
        throw new Error('expected ProofDeniedError');
      } catch (err) {
        expect(err).toBeInstanceOf(ProofDeniedError);
        expect((err as ProofDeniedError).code).toBe('EMPTY_ID');
        expect((err as ProofDeniedError).operation).toBe('insert');
      }
    });

    it('records a denial in the attestation log when rejected', () => {
      const token = guard.createToken('agent-deny', 'ns-deny', 'write');
      expect(() => backend.insert('', vec(), undefined, token)).toThrow(ProofDeniedError);
      const denied = log.query({ status: 'denied' });
      expect(denied.length).toBe(1);
      expect(denied[0].denial_code).toBe('EMPTY_ID');
      expect(denied[0].agent_id).toBe('agent-deny');
      expect(denied[0].namespace).toBe('ns-deny');
    });

    it('REJECTS an insert under an expired token without forwarding', () => {
      const expired = guard.createToken('a', 'd', 'write', -1);
      expect(() => backend.insert('vec-1', vec(), undefined, expired)).toThrow(/TOKEN_EXPIRED|token expired/i);
      expect(inner.calls.insert).toBe(0);
    });

    it('wraps an inner-backend failure as a BACKEND_ERROR ProofDeniedError', () => {
      inner.failOn.insert = 'inner exploded';
      try {
        backend.insert('vec-1', vec());
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ProofDeniedError);
        expect((err as ProofDeniedError).code).toBe('BACKEND_ERROR');
        expect((err as ProofDeniedError).message).toContain('inner exploded');
      }
      // The proof was recorded before the backend ran, then the backend error
      // is recorded as a separate denial.
      expect(log.query({ status: 'proved' }).length).toBe(1);
      expect(log.query({ status: 'denied' }).length).toBe(1);
    });
  });

  describe('insertBatch', () => {
    it('forwards a valid batch to the inner backend', () => {
      backend.insertBatch([
        { id: 'b-1', embedding: vec() },
        { id: 'b-2', embedding: vec() },
      ]);
      expect(inner.calls.insertBatch).toBe(1);
      expect(inner.store.size).toBe(2);
    });

    it('REJECTS an empty batch without forwarding', () => {
      try {
        backend.insertBatch([]);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ProofDeniedError);
        expect((err as ProofDeniedError).code).toBe('EMPTY_BATCH');
      }
      expect(inner.calls.insertBatch).toBe(0);
    });

    it('REJECTS a batch with a malicious id without forwarding', () => {
      expect(() =>
        backend.insertBatch([
          { id: 'ok', embedding: vec() },
          { id: '../evil', embedding: vec() },
        ]),
      ).toThrow(ProofDeniedError);
      expect(inner.calls.insertBatch).toBe(0);
      expect(inner.store.size).toBe(0);
    });

    it('wraps an inner batch failure as BACKEND_ERROR', () => {
      inner.failOn.insertBatch = 'batch boom';
      expect(() => backend.insertBatch([{ id: 'b-1', embedding: vec() }])).toThrow(/Backend error: batch boom/);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      backend.insert('vec-1', vec());
      backend.insert('vec-2', vec());
    });

    it('forwards a valid search and returns inner results', () => {
      const results = backend.search(vec(), 5);
      expect(inner.calls.search).toBe(1);
      expect(results.length).toBe(2);
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('similarity');
    });

    it('REJECTS a search with an out-of-bounds k without forwarding', () => {
      const innerSearchBefore = inner.calls.search;
      expect(() => backend.search(vec(), 0)).toThrow(ProofDeniedError);
      expect(inner.calls.search).toBe(innerSearchBefore);
    });

    it('REJECTS a search with a malformed query vector without forwarding', () => {
      const bad = vec();
      bad[0] = NaN;
      const innerSearchBefore = inner.calls.search;
      expect(() => backend.search(bad, 5)).toThrow(ProofDeniedError);
      expect(inner.calls.search).toBe(innerSearchBefore);
    });

    it('wraps an inner search failure as BACKEND_ERROR', () => {
      inner.failOn.search = 'search crash';
      expect(() => backend.search(vec(), 5)).toThrow(/Backend error: search crash/);
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      backend.insert('vec-1', vec());
    });

    it('forwards a valid remove and returns the inner result', () => {
      const removed = backend.remove('vec-1');
      expect(removed).toBe(true);
      expect(inner.calls.remove).toBe(1);
      expect(inner.store.has('vec-1')).toBe(false);
    });

    it('returns false from inner when the id is absent (but still proved)', () => {
      const removed = backend.remove('not-there');
      expect(removed).toBe(false);
      expect(inner.calls.remove).toBe(1);
    });

    it('REJECTS a remove with an invalid id without forwarding', () => {
      try {
        backend.remove('');
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ProofDeniedError);
        expect((err as ProofDeniedError).code).toBe('EMPTY_ID');
      }
      expect(inner.calls.remove).toBe(0);
    });

    it('wraps an inner remove failure as BACKEND_ERROR', () => {
      inner.failOn.remove = 'remove fail';
      expect(() => backend.remove('vec-1')).toThrow(/Backend error: remove fail/);
    });
  });

  describe('save', () => {
    it('forwards a valid save', async () => {
      await backend.save('snapshots/index.bin');
      expect(inner.calls.save).toBe(1);
    });

    it('REJECTS a path-traversal save without forwarding', async () => {
      await expect(backend.save('../../etc/passwd')).rejects.toThrow(ProofDeniedError);
      expect(inner.calls.save).toBe(0);
    });

    it('REJECTS an absolute save path without forwarding', async () => {
      await expect(backend.save('/etc/shadow')).rejects.toMatchObject({ code: 'ABSOLUTE_PATH' });
      expect(inner.calls.save).toBe(0);
    });

    it('wraps an inner save failure as BACKEND_ERROR', async () => {
      inner.failOn.save = 'disk full';
      await expect(backend.save('snapshots/index.bin')).rejects.toThrow(/Backend error: disk full/);
    });
  });

  describe('load', () => {
    it('forwards a valid load', async () => {
      await backend.load('snapshots/index.bin');
      expect(inner.calls.load).toBe(1);
    });

    it('REJECTS a path-traversal load without forwarding', async () => {
      await expect(backend.load('../secret')).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
      expect(inner.calls.load).toBe(0);
    });

    it('REJECTS a null-byte load path without forwarding', async () => {
      await expect(backend.load('a\x00b')).rejects.toMatchObject({ code: 'NULL_BYTE_IN_PATH' });
      expect(inner.calls.load).toBe(0);
    });

    it('wraps an inner load failure as BACKEND_ERROR', async () => {
      inner.failOn.load = 'corrupt file';
      await expect(backend.load('snapshots/index.bin')).rejects.toThrow(/Backend error: corrupt file/);
    });
  });

  describe('read-only pass-through (no proof required)', () => {
    it('exposes the wrapper name', () => {
      expect(backend.name).toBe('ruvector');
    });

    it('getStats forwards to inner and merges guard proof/denial counts', () => {
      backend.insert('vec-1', vec()); // 1 proof
      expect(() => backend.insert('', vec())).toThrow(); // 1 denial
      const stats = backend.getStats() as VectorStats & { totalProofs?: number; totalDenials?: number };
      expect(inner.calls.getStats).toBe(1);
      expect(stats.count).toBe(1);
      expect(stats.totalProofs).toBe(1);
      expect(stats.totalDenials).toBe(1);
    });

    it('getStats requires no proof and records nothing in the log', () => {
      backend.getStats();
      expect(log.getStats().total).toBe(0);
    });

    it('getLearning / setLearning pass through to inner without proof', () => {
      expect(backend.getLearning()).toBeNull();
      const learner = { kind: 'sarsa' };
      backend.setLearning(learner);
      expect(backend.getLearning()).toBe(learner);
      expect(log.getStats().total).toBe(0);
    });

    it('close passes through to inner without proof', () => {
      backend.close();
      expect(inner.calls.close).toBe(1);
      expect(inner.closed).toBe(true);
    });
  });

  describe('accessors', () => {
    it('getInner returns the wrapped backend', () => {
      expect(backend.getInner()).toBe(inner);
    });

    it('getGuard returns the mutation guard', () => {
      expect(backend.getGuard()).toBe(guard);
    });

    it('getLog returns the attestation log when configured', () => {
      expect(backend.getLog()).toBe(log);
    });
  });

  describe('without an attestation log', () => {
    let logless: GuardedVectorBackend;

    beforeEach(async () => {
      const g = new MutationGuard(makeConfig());
      await g.initialize();
      logless = new GuardedVectorBackend(new FakeVectorBackend(), g);
    });

    it('still allows valid mutations', () => {
      expect(() => logless.insert('vec-1', vec())).not.toThrow();
    });

    it('still rejects invalid mutations with ProofDeniedError', () => {
      expect(() => logless.insert('', vec())).toThrow(ProofDeniedError);
    });

    it('reports undefined for getLog', () => {
      expect(logless.getLog()).toBeUndefined();
    });
  });
});
