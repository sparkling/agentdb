/**
 * ADR-060: Proof-Gated State Mutation
 *
 * MutationGuard is the single validation gate between controllers and backends.
 * Every mutation must produce a MutationProof before the backend executes it.
 * If validation fails a MutationDenial is returned instead.
 * Optional WASM-accelerated proofs via @ruvnet/ruvector-verified-wasm.
 */

import { createHash, randomUUID } from 'crypto';
import { posix as posixPath } from 'path';
import {
  validateVector,
  validateVectorId,
  validateSearchOptions,
  SECURITY_LIMITS,
  sanitizeMetadata,
} from './validation.js';
import { ValidationError } from './input-validation.js';

export interface MutationProof {
  id: string;
  operation: 'insert' | 'search' | 'remove' | 'batch_insert' | 'save' | 'load';
  timestamp: number;
  structuralHash: string;
  attestation: AttestationToken;
  invariantChecks: InvariantResult[];
  wasmProofId?: number;
  valid: true;
}

export interface AttestationToken {
  agentId: string;
  namespace: string;
  scope: 'read' | 'write' | 'admin';
  issuedAt: number;
  expiresAt: number;
}

export interface InvariantResult {
  check: string;
  passed: boolean;
}

export interface MutationDenial {
  operation: string;
  reason: string;
  code: string;
  field?: string;
  timestamp: number;
}

export interface GuardConfig {
  dimension: number;
  maxElements: number;
  enableWasmProofs: boolean;
  enableAttestationLog: boolean;
  defaultNamespace: string;
}

const DEFAULT_TOKEN_TTL_MS = 300_000; // 5 minutes
const PROOF_TIME_WINDOW_SIZE = 200;

function makeDefaultToken(ns: string): AttestationToken {
  const now = Date.now();
  return { agentId: 'system', namespace: ns, scope: 'write', issuedAt: now, expiresAt: now + DEFAULT_TOKEN_TTL_MS };
}

function hashInsertInputs(id: string, embedding: Float32Array): string {
  const h = createHash('sha256');
  h.update(id);
  h.update(Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength));
  return h.digest('hex');
}

function hashBytes(...parts: (string | Buffer)[]): string {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex');
}

function deny(operation: string, reason: string, code: string, field?: string): MutationDenial {
  return { operation, reason, code, field, timestamp: Date.now() };
}

export class MutationGuard {
  private readonly config: GuardConfig;
  private vectorCount = 0;
  private wasmEnv: any = null;
  private wasmAvailable = false;
  private engineType: 'native' | 'wasm' | 'legacy-wasm' | 'js' = 'js';
  private nextWasmProofId = 1;
  private proofsIssuedCount = 0;
  private denialsCount = 0;
  private proofTimesNs: number[] = [];

  constructor(config: GuardConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (!this.config.enableWasmProofs) return;

    // Use GraphTransformerService for unified proof backend
    try {
      const { GraphTransformerService } = await import('../services/GraphTransformerService.js');
      const gts = new GraphTransformerService();
      await gts.initialize();

      if (gts.isAvailable()) {
        this.wasmEnv = gts;
        this.wasmAvailable = true;
        const stats = gts.getStats();
        this.engineType = stats.engineType === 'native' ? 'native' : 'wasm';
        console.log(`[MutationGuard] Initialized with ${this.engineType} proof engine`);
        return;
      }
    } catch (error) {
      console.warn('[MutationGuard] GraphTransformerService initialization failed:', error);
    }

    // Legacy fallback: @ruvnet/ruvector-verified-wasm
    try {
      const mod = await import('@ruvnet/ruvector-verified-wasm' as string);
      if (mod && typeof mod.JsProofEnv === 'function') {
        this.wasmEnv = new mod.JsProofEnv();
        this.wasmAvailable = true;
        this.engineType = 'legacy-wasm';
        console.log('[MutationGuard] Using legacy verified-wasm proof engine');
        return;
      }
    } catch { /* legacy WASM not available */ }

    // Pure JS validation fallback (no attestations, but still validates)
    this.engineType = 'js';
    this.wasmAvailable = false;
    console.log('[MutationGuard] No accelerated proof engine available, using JS validation');
  }

  private validateToken(token: AttestationToken): MutationDenial | null {
    if (token.expiresAt < Date.now()) {
      return deny('token_validation', 'Authentication token expired', 'TOKEN_EXPIRED');
    }
    return null;
  }

  proveInsert(
    id: string, embedding: Float32Array,
    metadata?: Record<string, any>, token?: AttestationToken,
  ): MutationProof | MutationDenial {
    const start = this.hrtimeNs();
    const att = token ?? makeDefaultToken(this.config.defaultNamespace);
    const tokenErr = this.validateToken(att);
    if (tokenErr) { this.denialsCount++; return tokenErr; }
    const inv: InvariantResult[] = [];

    try { validateVectorId(id); } catch (err) {
      this.denialsCount++;
      const ve = err as ValidationError;
      return deny('insert', ve.message, ve.code ?? 'INVALID_ID', ve.field);
    }
    try { validateVector(embedding, this.config.dimension); } catch (err) {
      this.denialsCount++;
      const ve = err as ValidationError;
      return deny('insert', ve.message, ve.code ?? 'INVALID_VECTOR', ve.field);
    }
    if (metadata) {
      try { sanitizeMetadata(metadata); } catch (err) {
        this.denialsCount++;
        const ve = err as ValidationError;
        return deny('insert', ve.message, ve.code ?? 'INVALID_METADATA', ve.field);
      }
    }

    const capacityOk = this.vectorCount < this.config.maxElements;
    inv.push({ check: 'capacity', passed: capacityOk });
    if (!capacityOk) {
      this.denialsCount++;
      return deny('insert', 'Index capacity exceeded', 'CAPACITY_EXCEEDED');
    }

    let wasmProofId: number | undefined;
    let attestationBytes: Uint8Array | undefined;
    if (this.wasmAvailable && this.wasmEnv) {
      try {
        if (this.engineType === 'native' || this.engineType === 'wasm') {
          // GraphTransformerService provides unified API
          const dimProof = this.wasmEnv.proveDimension(this.config.dimension, embedding.length);
          if (dimProof && dimProof.verified !== false) {
            wasmProofId = dimProof.proof_id ?? this.nextWasmProofId++;
            attestationBytes = this.wasmEnv.createAttestation?.(wasmProofId) ?? undefined;
            inv.push({ check: `graph_transformer_${this.engineType}_verify`, passed: true });
          } else {
            inv.push({ check: `graph_transformer_${this.engineType}_verify`, passed: false });
          }
        } else if (this.engineType === 'legacy-wasm') {
          // Legacy @ruvnet/ruvector-verified-wasm
          this.wasmEnv.verify_dim_check(this.config.dimension, embedding);
          wasmProofId = this.nextWasmProofId++;
          this.wasmEnv.create_attestation(wasmProofId);
          inv.push({ check: 'legacy_wasm_dim_verify', passed: true });
        }
      } catch (error) {
        inv.push({ check: 'proof_engine_verify', passed: false });
      }
    }

    this.vectorCount++;
    const proof = this.buildProof('insert', hashInsertInputs(id, embedding), att, inv, wasmProofId);
    this.recordProofTime(start);
    return proof;
  }

  proveSearch(
    query: Float32Array, k: number,
    options?: any, token?: AttestationToken,
  ): MutationProof | MutationDenial {
    const start = this.hrtimeNs();
    const att = token ?? makeDefaultToken(this.config.defaultNamespace);
    const tokenErr = this.validateToken(att);
    if (tokenErr) { this.denialsCount++; return tokenErr; }
    const inv: InvariantResult[] = [];

    try { validateVector(query, this.config.dimension); } catch (err) {
      this.denialsCount++;
      const ve = err as ValidationError;
      return deny('search', ve.message, ve.code ?? 'INVALID_VECTOR', ve.field);
    }
    try { validateSearchOptions({ k, ...options }); } catch (err) {
      this.denialsCount++;
      const ve = err as ValidationError;
      return deny('search', ve.message, ve.code ?? 'INVALID_SEARCH_OPTIONS', ve.field);
    }

    inv.push({ check: 'query_valid', passed: true });
    inv.push({ check: 'options_valid', passed: true });
    const structuralHash = hashBytes(
      Buffer.from(query.buffer, query.byteOffset, query.byteLength), String(k),
    );
    const proof = this.buildProof('search', structuralHash, att, inv);
    this.recordProofTime(start);
    return proof;
  }

  proveBatchInsert(
    items: Array<{ id: string; embedding: Float32Array; metadata?: Record<string, any> }>,
    token?: AttestationToken,
  ): MutationProof | MutationDenial {
    const start = this.hrtimeNs();
    const att = token ?? makeDefaultToken(this.config.defaultNamespace);
    const tokenErr = this.validateToken(att);
    if (tokenErr) { this.denialsCount++; return tokenErr; }
    const inv: InvariantResult[] = [];

    if (!items || items.length === 0) {
      this.denialsCount++;
      return deny('batch_insert', 'Batch is empty', 'EMPTY_BATCH');
    }
    if (items.length > SECURITY_LIMITS.MAX_BATCH_SIZE) {
      this.denialsCount++;
      return deny('batch_insert', 'Batch size exceeds maximum allowed limit', 'BATCH_SIZE_EXCEEDED');
    }
    inv.push({ check: 'batch_size', passed: true });

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try { validateVectorId(item.id); } catch (err) {
        this.denialsCount++;
        const ve = err as ValidationError;
        return deny('batch_insert', `Item ${i}: ${ve.message}`, ve.code ?? 'INVALID_ID', `items[${i}].id`);
      }
      try { validateVector(item.embedding, this.config.dimension); } catch (err) {
        this.denialsCount++;
        const ve = err as ValidationError;
        return deny('batch_insert', `Item ${i}: ${ve.message}`, ve.code ?? 'INVALID_VECTOR', `items[${i}].embedding`);
      }
      if (item.metadata) {
        try { sanitizeMetadata(item.metadata); } catch (err) {
          this.denialsCount++;
          const ve = err as ValidationError;
          return deny('batch_insert', `Item ${i}: ${ve.message}`, ve.code ?? 'INVALID_METADATA', `items[${i}].metadata`);
        }
      }
    }
    inv.push({ check: 'items_valid', passed: true });

    const capacityOk = this.vectorCount + items.length <= this.config.maxElements;
    inv.push({ check: 'capacity', passed: capacityOk });
    if (!capacityOk) {
      this.denialsCount++;
      return deny('batch_insert', 'Batch would exceed index capacity', 'CAPACITY_EXCEEDED');
    }

    const h = createHash('sha256');
    for (const item of items) {
      h.update(item.id);
      h.update(Buffer.from(item.embedding.buffer, item.embedding.byteOffset, item.embedding.byteLength));
    }

    this.vectorCount += items.length;
    const proof = this.buildProof('batch_insert', h.digest('hex'), att, inv);
    this.recordProofTime(start);
    return proof;
  }

  proveRemove(id: string, token?: AttestationToken): MutationProof | MutationDenial {
    const start = this.hrtimeNs();
    const att = token ?? makeDefaultToken(this.config.defaultNamespace);
    const tokenErr = this.validateToken(att);
    if (tokenErr) { this.denialsCount++; return tokenErr; }
    const inv: InvariantResult[] = [];

    try { validateVectorId(id); } catch (err) {
      this.denialsCount++;
      const ve = err as ValidationError;
      return deny('remove', ve.message, ve.code ?? 'INVALID_ID', ve.field);
    }
    inv.push({ check: 'id_valid', passed: true });

    if (this.vectorCount > 0) this.vectorCount--;
    const proof = this.buildProof('remove', hashBytes(id), att, inv);
    this.recordProofTime(start);
    return proof;
  }

  proveSave(path: string, token?: AttestationToken): MutationProof | MutationDenial {
    const start = this.hrtimeNs();
    const att = token ?? makeDefaultToken(this.config.defaultNamespace);
    const tokenErr = this.validateToken(att);
    if (tokenErr) { this.denialsCount++; return tokenErr; }
    const inv: InvariantResult[] = [];
    const pathErr = this.validateSafePath(path, 'save');
    if (pathErr !== null) { this.denialsCount++; return pathErr; }
    inv.push({ check: 'path_safe', passed: true });
    const proof = this.buildProof('save', hashBytes(path), att, inv);
    this.recordProofTime(start);
    return proof;
  }

  proveLoad(path: string, token?: AttestationToken): MutationProof | MutationDenial {
    const start = this.hrtimeNs();
    const att = token ?? makeDefaultToken(this.config.defaultNamespace);
    const tokenErr = this.validateToken(att);
    if (tokenErr) { this.denialsCount++; return tokenErr; }
    const inv: InvariantResult[] = [];
    const pathErr = this.validateSafePath(path, 'load');
    if (pathErr !== null) { this.denialsCount++; return pathErr; }
    inv.push({ check: 'path_safe', passed: true });
    const proof = this.buildProof('load', hashBytes(path), att, inv);
    this.recordProofTime(start);
    return proof;
  }

  createToken(
    agentId: string, namespace: string,
    scope: 'read' | 'write' | 'admin', ttlMs: number = DEFAULT_TOKEN_TTL_MS,
  ): AttestationToken {
    const now = Date.now();
    return { agentId, namespace, scope, issuedAt: now, expiresAt: now + ttlMs };
  }

  getStats(): { proofsIssued: number; denials: number; wasmAvailable: boolean; engineType: string; avgProofTimeNs: number } {
    const avg = this.proofTimesNs.length > 0
      ? this.proofTimesNs.reduce((a, b) => a + b, 0) / this.proofTimesNs.length
      : 0;
    return { proofsIssued: this.proofsIssuedCount, denials: this.denialsCount, wasmAvailable: this.wasmAvailable, engineType: this.engineType, avgProofTimeNs: avg };
  }

  static isDenial(result: MutationProof | MutationDenial): result is MutationDenial {
    return !('valid' in result);
  }

  getVectorCount(): number { return this.vectorCount; }

  setVectorCount(count: number): void { this.vectorCount = count; }

  private buildProof(
    operation: MutationProof['operation'], structuralHash: string,
    attestation: AttestationToken, invariantChecks: InvariantResult[], wasmProofId?: number,
  ): MutationProof {
    this.proofsIssuedCount++;
    return {
      id: randomUUID(), operation, timestamp: Date.now(),
      structuralHash, attestation, invariantChecks, wasmProofId, valid: true,
    };
  }

  private validateSafePath(filePath: string, operation: string): MutationDenial | null {
    if (!filePath || typeof filePath !== 'string')
      return deny(operation, 'Path must be a non-empty string', 'INVALID_PATH', 'path');
    if (filePath.includes('\x00'))
      return deny(operation, 'Path contains null bytes', 'NULL_BYTE_IN_PATH', 'path');
    // Normalize to resolve sequences like a/../b, then reject traversal
    const normalized = posixPath.normalize(filePath);
    if (normalized.startsWith('..') || normalized.includes('/..'))
      return deny(operation, 'Path traversal attempt detected', 'PATH_TRAVERSAL', 'path');
    if (posixPath.isAbsolute(normalized) || /^[a-zA-Z]:[\\/]/.test(filePath))
      return deny(operation, 'Absolute paths are not allowed', 'ABSOLUTE_PATH', 'path');
    return null;
  }

  private hrtimeNs(): bigint { return process.hrtime.bigint(); }

  private recordProofTime(start: bigint): void {
    const elapsed = Number(process.hrtime.bigint() - start);
    this.proofTimesNs.push(elapsed);
    if (this.proofTimesNs.length > PROOF_TIME_WINDOW_SIZE) this.proofTimesNs.shift();
  }
}
