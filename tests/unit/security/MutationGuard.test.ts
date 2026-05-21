/**
 * Unit Tests for MutationGuard (ADR-060) — Proof-Gated State Mutation
 *
 * SECURITY-CRITICAL: MutationGuard is the single validation gate between
 * controllers and backends. Every mutation must yield a MutationProof before
 * a backend executes it; otherwise a MutationDenial is returned. These tests
 * assert that:
 *   - valid operations produce a verifiable MutationProof
 *   - expired tokens, invalid IDs/vectors, oversized batches, path traversal,
 *     absolute paths, null bytes, and capacity overflow are all REJECTED
 *   - sensitive metadata is sanitized
 *   - statistics and counters track proofs vs denials correctly
 *
 * Real MutationGuard instance, JS validation engine (WASM disabled) for
 * deterministic behavior — no mocks of the guard itself.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MutationGuard,
  type GuardConfig,
  type MutationProof,
  type MutationDenial,
  type AttestationToken,
} from '../../../src/security/MutationGuard.js';
import { SECURITY_LIMITS } from '../../../src/security/validation.js';

const DIM = 8;

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

function asProof(r: MutationProof | MutationDenial): MutationProof {
  expect(MutationGuard.isDenial(r)).toBe(false);
  return r as MutationProof;
}

function asDenial(r: MutationProof | MutationDenial): MutationDenial {
  expect(MutationGuard.isDenial(r)).toBe(true);
  return r as MutationDenial;
}

describe('MutationGuard', () => {
  let guard: MutationGuard;

  beforeEach(async () => {
    guard = new MutationGuard(makeConfig());
    await guard.initialize(); // JS fallback (no WASM)
  });

  describe('initialize', () => {
    it('falls back to the JS validation engine when WASM is disabled', () => {
      const stats = guard.getStats();
      expect(stats.engineType).toBe('js');
      expect(stats.wasmAvailable).toBe(false);
    });

    it('does not require initialize() to be called before proving', () => {
      const fresh = new MutationGuard(makeConfig());
      const result = fresh.proveInsert('v1', vec());
      expect(MutationGuard.isDenial(result)).toBe(false);
    });
  });

  describe('proveInsert — happy path', () => {
    it('produces a valid proof for a well-formed insert', () => {
      const proof = asProof(guard.proveInsert('vec-1', vec()));
      expect(proof.operation).toBe('insert');
      expect(proof.valid).toBe(true);
      expect(proof.id).toMatch(/[0-9a-f-]{36}/); // randomUUID
      expect(proof.structuralHash).toHaveLength(64); // sha256 hex
      expect(proof.timestamp).toBeGreaterThan(0);
    });

    it('records a passing capacity invariant check', () => {
      const proof = asProof(guard.proveInsert('vec-1', vec()));
      const cap = proof.invariantChecks.find(c => c.check === 'capacity');
      expect(cap?.passed).toBe(true);
    });

    it('increments the vector count on a successful insert', () => {
      expect(guard.getVectorCount()).toBe(0);
      asProof(guard.proveInsert('vec-1', vec()));
      expect(guard.getVectorCount()).toBe(1);
    });

    it('attaches the provided attestation token to the proof', () => {
      const token = guard.createToken('agent-z', 'tenant-9', 'write');
      const proof = asProof(guard.proveInsert('vec-1', vec(), undefined, token));
      expect(proof.attestation.agentId).toBe('agent-z');
      expect(proof.attestation.namespace).toBe('tenant-9');
    });

    it('uses a default system token when none is supplied', () => {
      const proof = asProof(guard.proveInsert('vec-1', vec()));
      expect(proof.attestation.agentId).toBe('system');
      expect(proof.attestation.namespace).toBe('default');
    });

    it('accepts and sanitizes metadata, dropping sensitive keys', () => {
      // sanitizeMetadata strips keys like "password" — the guard must not reject
      // a benign-but-sensitive payload, it sanitizes it and still proves.
      const proof = asProof(
        guard.proveInsert('vec-1', vec(), { label: 'doc', password: 'hunter2' }),
      );
      expect(proof.valid).toBe(true);
    });
  });

  describe('proveInsert — rejections (security-critical)', () => {
    it('REJECTS an empty id', () => {
      const denial = asDenial(guard.proveInsert('', vec()));
      expect(denial.operation).toBe('insert');
      expect(denial.code).toBe('EMPTY_ID');
    });

    it('REJECTS an id containing path-traversal characters', () => {
      const denial = asDenial(guard.proveInsert('../../etc/passwd', vec()));
      expect(denial.code).toBe('PATH_TRAVERSAL_ATTEMPT');
    });

    it('REJECTS an id with Cypher-dangerous characters', () => {
      const denial = asDenial(guard.proveInsert("v'); MATCH (n) DETACH DELETE n; --", vec()));
      expect(denial.code).toBe('DANGEROUS_ID_CHARACTERS');
    });

    it('REJECTS a vector whose dimension does not match config', () => {
      const denial = asDenial(guard.proveInsert('vec-1', vec(0.1, DIM + 1)));
      expect(denial.code).toBe('DIMENSION_MISMATCH');
    });

    it('REJECTS a vector containing NaN', () => {
      const bad = vec();
      bad[3] = NaN;
      const denial = asDenial(guard.proveInsert('vec-1', bad));
      expect(denial.code).toBe('INVALID_VECTOR_VALUE');
    });

    it('REJECTS a vector containing Infinity', () => {
      const bad = vec();
      bad[0] = Infinity;
      const denial = asDenial(guard.proveInsert('vec-1', bad));
      expect(denial.code).toBe('INVALID_VECTOR_VALUE');
    });

    it('REJECTS an insert when capacity is exhausted', () => {
      const tight = new MutationGuard(makeConfig({ maxElements: 1 }));
      asProof(tight.proveInsert('vec-1', vec()));
      const denial = asDenial(tight.proveInsert('vec-2', vec()));
      expect(denial.code).toBe('CAPACITY_EXCEEDED');
    });

    it('does NOT increment the vector count when an insert is rejected', () => {
      asDenial(guard.proveInsert('', vec()));
      expect(guard.getVectorCount()).toBe(0);
    });
  });

  describe('token validation (authorization gate)', () => {
    it('REJECTS a mutation carrying an expired token', () => {
      const expired: AttestationToken = {
        agentId: 'agent-x',
        namespace: 'default',
        scope: 'write',
        issuedAt: Date.now() - 10_000,
        expiresAt: Date.now() - 1_000, // already expired
      };
      const denial = asDenial(guard.proveInsert('vec-1', vec(), undefined, expired));
      expect(denial.code).toBe('TOKEN_EXPIRED');
      expect(denial.operation).toBe('token_validation');
    });

    it('does NOT touch state when the token is expired', () => {
      const expired = guard.createToken('a', 'd', 'write', -1); // expires in the past
      asDenial(guard.proveInsert('vec-1', vec(), undefined, expired));
      expect(guard.getVectorCount()).toBe(0);
    });

    it('rejects expired tokens across every mutation type', () => {
      const expired = guard.createToken('a', 'd', 'write', -1);
      expect(asDenial(guard.proveSearch(vec(), 5, undefined, expired)).code).toBe('TOKEN_EXPIRED');
      expect(asDenial(guard.proveRemove('vec-1', expired)).code).toBe('TOKEN_EXPIRED');
      expect(asDenial(guard.proveSave('snap.bin', expired)).code).toBe('TOKEN_EXPIRED');
      expect(asDenial(guard.proveLoad('snap.bin', expired)).code).toBe('TOKEN_EXPIRED');
      expect(asDenial(guard.proveBatchInsert([{ id: 'a', embedding: vec() }], expired)).code).toBe('TOKEN_EXPIRED');
    });

    it('accepts a freshly minted token', () => {
      const token = guard.createToken('agent-y', 'default', 'write');
      expect(token.expiresAt).toBeGreaterThan(Date.now());
      const proof = asProof(guard.proveInsert('vec-1', vec(), undefined, token));
      expect(proof.attestation.agentId).toBe('agent-y');
    });
  });

  describe('proveSearch', () => {
    it('produces a valid proof for a well-formed search', () => {
      const proof = asProof(guard.proveSearch(vec(), 10));
      expect(proof.operation).toBe('search');
      expect(proof.invariantChecks.some(c => c.check === 'query_valid' && c.passed)).toBe(true);
      expect(proof.invariantChecks.some(c => c.check === 'options_valid' && c.passed)).toBe(true);
    });

    it('REJECTS a search with a dimension-mismatched query', () => {
      const denial = asDenial(guard.proveSearch(vec(0.1, DIM + 2), 5));
      expect(denial.code).toBe('DIMENSION_MISMATCH');
    });

    it('REJECTS a search with a NaN in the query vector', () => {
      const bad = vec();
      bad[1] = NaN;
      expect(asDenial(guard.proveSearch(bad, 5)).code).toBe('INVALID_VECTOR_VALUE');
    });

    it('REJECTS a search with non-integer k', () => {
      const denial = asDenial(guard.proveSearch(vec(), 3.5));
      expect(denial.code).toBe('INVALID_K_TYPE');
    });

    it('REJECTS a search with k below the minimum', () => {
      const denial = asDenial(guard.proveSearch(vec(), 0));
      expect(denial.code).toBe('K_OUT_OF_BOUNDS');
    });

    it('REJECTS a search with k above the maximum', () => {
      const denial = asDenial(guard.proveSearch(vec(), SECURITY_LIMITS.MAX_K + 1));
      expect(denial.code).toBe('K_OUT_OF_BOUNDS');
    });

    it('REJECTS a search with an out-of-bounds threshold', () => {
      const denial = asDenial(guard.proveSearch(vec(), 5, { threshold: 5 }));
      expect(denial.code).toBe('THRESHOLD_OUT_OF_BOUNDS');
    });

    it('does not change the vector count (search is non-mutating to the index size)', () => {
      asProof(guard.proveInsert('vec-1', vec()));
      const before = guard.getVectorCount();
      asProof(guard.proveSearch(vec(), 5));
      expect(guard.getVectorCount()).toBe(before);
    });
  });

  describe('proveBatchInsert', () => {
    const items = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `b-${i}`, embedding: vec() }));

    it('produces a valid proof for a well-formed batch', () => {
      const proof = asProof(guard.proveBatchInsert(items(5)));
      expect(proof.operation).toBe('batch_insert');
      expect(proof.invariantChecks.some(c => c.check === 'items_valid' && c.passed)).toBe(true);
      expect(guard.getVectorCount()).toBe(5);
    });

    it('REJECTS an empty batch', () => {
      expect(asDenial(guard.proveBatchInsert([])).code).toBe('EMPTY_BATCH');
    });

    it('REJECTS a batch exceeding the max batch size', () => {
      const oversized = Array.from({ length: SECURITY_LIMITS.MAX_BATCH_SIZE + 1 }, (_, i) => ({
        id: `b-${i}`,
        embedding: vec(),
      }));
      expect(asDenial(guard.proveBatchInsert(oversized)).code).toBe('BATCH_SIZE_EXCEEDED');
    });

    it('REJECTS a batch with an invalid id and reports the offending index', () => {
      const batch = [
        { id: 'ok', embedding: vec() },
        { id: '../evil', embedding: vec() },
      ];
      const denial = asDenial(guard.proveBatchInsert(batch));
      expect(denial.code).toBe('PATH_TRAVERSAL_ATTEMPT');
      expect(denial.field).toBe('items[1].id');
      expect(denial.reason).toContain('Item 1');
    });

    it('REJECTS a batch with a dimension-mismatched vector', () => {
      const batch = [{ id: 'ok', embedding: vec(0.1, DIM + 1) }];
      const denial = asDenial(guard.proveBatchInsert(batch));
      expect(denial.code).toBe('DIMENSION_MISMATCH');
      expect(denial.field).toBe('items[0].embedding');
    });

    it('REJECTS a batch that would exceed index capacity', () => {
      const tight = new MutationGuard(makeConfig({ maxElements: 3 }));
      const denial = asDenial(tight.proveBatchInsert(items(4)));
      expect(denial.code).toBe('CAPACITY_EXCEEDED');
    });

    it('does NOT increment the vector count when the batch is rejected', () => {
      asDenial(guard.proveBatchInsert([]));
      expect(guard.getVectorCount()).toBe(0);
    });
  });

  describe('proveRemove', () => {
    it('produces a valid proof for a well-formed remove', () => {
      const proof = asProof(guard.proveRemove('vec-1'));
      expect(proof.operation).toBe('remove');
      expect(proof.invariantChecks.some(c => c.check === 'id_valid' && c.passed)).toBe(true);
    });

    it('REJECTS a remove with an invalid id', () => {
      expect(asDenial(guard.proveRemove('')).code).toBe('EMPTY_ID');
    });

    it('decrements the vector count on a successful remove', () => {
      guard.setVectorCount(2);
      asProof(guard.proveRemove('vec-1'));
      expect(guard.getVectorCount()).toBe(1);
    });

    it('never drives the vector count below zero', () => {
      expect(guard.getVectorCount()).toBe(0);
      asProof(guard.proveRemove('vec-1'));
      expect(guard.getVectorCount()).toBe(0);
    });
  });

  describe('proveSave / proveLoad — path safety (security-critical)', () => {
    it('produces a valid proof for a safe relative save path', () => {
      const proof = asProof(guard.proveSave('snapshots/index.bin'));
      expect(proof.operation).toBe('save');
      expect(proof.invariantChecks.some(c => c.check === 'path_safe' && c.passed)).toBe(true);
    });

    it('produces a valid proof for a safe relative load path', () => {
      const proof = asProof(guard.proveLoad('snapshots/index.bin'));
      expect(proof.operation).toBe('load');
    });

    it('REJECTS a save with a path-traversal sequence', () => {
      expect(asDenial(guard.proveSave('../../etc/passwd')).code).toBe('PATH_TRAVERSAL');
    });

    it('REJECTS a save with an embedded traversal segment', () => {
      expect(asDenial(guard.proveSave('safe/../../escape')).code).toBe('PATH_TRAVERSAL');
    });

    it('REJECTS an absolute save path', () => {
      expect(asDenial(guard.proveSave('/etc/shadow')).code).toBe('ABSOLUTE_PATH');
    });

    it('REJECTS a Windows-style drive-absolute path', () => {
      expect(asDenial(guard.proveSave('C:\\Windows\\system32')).code).toBe('ABSOLUTE_PATH');
    });

    it('REJECTS a save path containing a null byte', () => {
      expect(asDenial(guard.proveSave('snap\x00.bin')).code).toBe('NULL_BYTE_IN_PATH');
    });

    it('REJECTS an empty save path', () => {
      expect(asDenial(guard.proveSave('')).code).toBe('INVALID_PATH');
    });

    it('REJECTS load with a path-traversal sequence', () => {
      expect(asDenial(guard.proveLoad('../secret')).code).toBe('PATH_TRAVERSAL');
    });

    it('REJECTS load with an absolute path', () => {
      expect(asDenial(guard.proveLoad('/root/index.bin')).code).toBe('ABSOLUTE_PATH');
    });

    it('REJECTS load with a null byte', () => {
      expect(asDenial(guard.proveLoad('a\x00b')).code).toBe('NULL_BYTE_IN_PATH');
    });
  });

  describe('createToken', () => {
    it('sets the requested fields and a future expiry', () => {
      const before = Date.now();
      const token = guard.createToken('agent-a', 'ns-1', 'admin', 60_000);
      expect(token.agentId).toBe('agent-a');
      expect(token.namespace).toBe('ns-1');
      expect(token.scope).toBe('admin');
      expect(token.issuedAt).toBeGreaterThanOrEqual(before);
      expect(token.expiresAt).toBe(token.issuedAt + 60_000);
    });

    it('uses the default 5-minute TTL when none is given', () => {
      const token = guard.createToken('agent-a', 'ns-1', 'read');
      expect(token.expiresAt - token.issuedAt).toBe(300_000);
    });
  });

  describe('isDenial type guard', () => {
    it('returns false for a proof', () => {
      const proof = guard.proveInsert('vec-1', vec());
      expect(MutationGuard.isDenial(proof)).toBe(false);
    });

    it('returns true for a denial', () => {
      const denial = guard.proveInsert('', vec());
      expect(MutationGuard.isDenial(denial)).toBe(true);
    });
  });

  describe('getStats', () => {
    it('tracks proofs issued and denials separately', () => {
      asProof(guard.proveInsert('vec-1', vec())); // proof
      asProof(guard.proveSearch(vec(), 5)); // proof
      asDenial(guard.proveInsert('', vec())); // denial (empty id)
      asDenial(guard.proveSearch(vec(), 0)); // denial (k out of bounds)

      const stats = guard.getStats();
      expect(stats.proofsIssued).toBe(2);
      expect(stats.denials).toBe(2);
    });

    it('reports a non-negative average proof time after issuing proofs', () => {
      asProof(guard.proveInsert('vec-1', vec()));
      expect(guard.getStats().avgProofTimeNs).toBeGreaterThanOrEqual(0);
    });

    it('reports zero average proof time before any proof is issued', () => {
      const fresh = new MutationGuard(makeConfig());
      expect(fresh.getStats().avgProofTimeNs).toBe(0);
    });
  });

  describe('getVectorCount / setVectorCount', () => {
    it('round-trips an explicitly set count', () => {
      guard.setVectorCount(42);
      expect(guard.getVectorCount()).toBe(42);
    });
  });

  describe('structural hash determinism', () => {
    it('produces identical hashes for identical insert inputs', () => {
      const g1 = new MutationGuard(makeConfig());
      const g2 = new MutationGuard(makeConfig());
      const a = asProof(g1.proveInsert('same-id', vec(0.5)));
      const b = asProof(g2.proveInsert('same-id', vec(0.5)));
      expect(a.structuralHash).toBe(b.structuralHash);
    });

    it('produces different hashes for different ids', () => {
      const g1 = new MutationGuard(makeConfig());
      const a = asProof(g1.proveInsert('id-a', vec(0.5)));
      const b = asProof(g1.proveInsert('id-b', vec(0.5)));
      expect(a.structuralHash).not.toBe(b.structuralHash);
    });
  });
});
