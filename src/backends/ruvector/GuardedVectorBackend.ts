/**
 * GuardedVectorBackend - Proof-Gated State Mutation (ADR-060)
 *
 * A drop-in replacement for RuVectorBackend that requires cryptographic
 * mutation proofs before allowing any state-changing operation. Read-only
 * operations pass through without proof.
 *
 * Architecture:
 * - Wraps any VectorBackend implementation
 * - MutationGuard validates and attests each mutation
 * - AttestationLog records all proof attempts for audit
 * - ProofDeniedError thrown when mutation is rejected
 *
 * Mutating operations (require proof):
 *   insert, insertBatch, search, remove, save, load
 *
 * Read-only operations (pass through):
 *   getStats, getLearning, setLearning, close
 */

import type { VectorBackend, VectorConfig, SearchResult, SearchOptions, VectorStats } from '../VectorBackend.js';
import type { MutationProof, MutationDenial, AttestationToken } from '../../security/MutationGuard.js';
import { MutationGuard } from '../../security/MutationGuard.js';
import type { AttestationLog } from '../../security/AttestationLog.js';

/**
 * Error thrown when a mutation proof is denied by the guard.
 *
 * Contains the denial reason, error code, operation name,
 * and the full MutationDenial object for programmatic handling.
 */
export class ProofDeniedError extends Error {
  public readonly code: string;
  public readonly operation: string;
  public readonly denial: MutationDenial;

  constructor(reason: string, code: string, operation: string, denial: MutationDenial) {
    super(`Proof denied for ${operation}: ${reason}`);
    this.name = 'ProofDeniedError';
    this.code = code;
    this.operation = operation;
    this.denial = denial;
  }
}

/**
 * GuardedVectorBackend - VectorBackend wrapper with proof-gated mutations
 *
 * Every mutating method requires an optional AttestationToken. When provided,
 * the token is validated by MutationGuard before the operation proceeds.
 * If the proof is denied, a ProofDeniedError is thrown and the operation
 * is not forwarded to the inner backend.
 */
export class GuardedVectorBackend implements VectorBackend {
  readonly name = 'ruvector' as const;

  private readonly inner: VectorBackend;
  private readonly guard: MutationGuard;
  private readonly log?: AttestationLog;

  constructor(inner: VectorBackend, guard: MutationGuard, log?: AttestationLog) {
    this.inner = inner;
    this.guard = guard;
    this.log = log;
  }

  private requireProof(
    result: MutationProof | MutationDenial,
    operation: string,
    token?: AttestationToken,
  ): asserts result is MutationProof {
    if (MutationGuard.isDenial(result)) {
      if (this.log) {
        this.log.recordDenial(result, token?.agentId ?? 'unknown', token?.namespace ?? 'default');
      }
      throw new ProofDeniedError(result.reason, result.code, operation, result);
    }
    if (this.log) {
      this.log.record(result);
    }
  }

  private wrapBackendError(err: unknown, operation: string, token?: AttestationToken): never {
    const msg = (err as Error).message ?? String(err);
    const denial: MutationDenial = { operation, reason: `Backend error: ${msg}`, code: 'BACKEND_ERROR', timestamp: Date.now() };
    if (this.log) this.log.recordDenial(denial, token?.agentId ?? 'unknown', token?.namespace ?? 'default');
    throw new ProofDeniedError(denial.reason, denial.code, operation, denial);
  }

  insert(
    id: string,
    embedding: Float32Array,
    metadata?: Record<string, any>,
    token?: AttestationToken
  ): void {
    this.requireProof(this.guard.proveInsert(id, embedding, metadata, token), 'insert', token);
    try {
      this.inner.insert(id, embedding, metadata);
    } catch (err) {
      this.wrapBackendError(err, 'insert', token);
    }
  }

  insertBatch(
    items: Array<{ id: string; embedding: Float32Array; metadata?: Record<string, any> }>,
    token?: AttestationToken
  ): void {
    this.requireProof(this.guard.proveBatchInsert(items, token), 'insertBatch', token);
    try {
      this.inner.insertBatch(items);
    } catch (err) {
      this.wrapBackendError(err, 'insertBatch', token);
    }
  }

  search(
    query: Float32Array,
    k: number,
    options?: SearchOptions,
    token?: AttestationToken
  ): SearchResult[] {
    this.requireProof(this.guard.proveSearch(query, k, options, token), 'search', token);
    try {
      return this.inner.search(query, k, options);
    } catch (err) {
      this.wrapBackendError(err, 'search', token);
    }
  }

  remove(id: string, token?: AttestationToken): boolean {
    this.requireProof(this.guard.proveRemove(id, token), 'remove', token);
    try {
      return this.inner.remove(id);
    } catch (err) {
      this.wrapBackendError(err, 'remove', token);
    }
  }

  async save(path: string, token?: AttestationToken): Promise<void> {
    this.requireProof(this.guard.proveSave(path, token), 'save', token);
    try {
      return await this.inner.save(path);
    } catch (err) {
      this.wrapBackendError(err, 'save', token);
    }
  }

  async load(path: string, token?: AttestationToken): Promise<void> {
    this.requireProof(this.guard.proveLoad(path, token), 'load', token);
    try {
      return await this.inner.load(path);
    } catch (err) {
      this.wrapBackendError(err, 'load', token);
    }
  }

  /**
   * Get backend statistics (read-only, no proof required).
   *
   * Merges inner backend stats with guard stats and optional log stats.
   */
  getStats(): VectorStats {
    const innerStats = this.inner.getStats();
    const guardStats = this.guard.getStats();

    return {
      ...innerStats,
      ...(guardStats.proofsIssued !== undefined && {
        totalProofs: guardStats.proofsIssued,
        totalDenials: guardStats.denials,
      }),
    } as VectorStats & {
      totalProofs?: number;
      totalDenials?: number;
    };
  }

  /**
   * Get the learning instance from the inner backend (read-only, no proof required).
   */
  getLearning(): any {
    return (this.inner as any).getLearning?.() ?? null;
  }

  /**
   * Set the learning instance on the inner backend (pass-through, no proof required).
   */
  setLearning(learning: any): void {
    (this.inner as any).setLearning?.(learning);
  }

  /**
   * Close and cleanup resources (pass-through, no proof required).
   */
  close(): void {
    this.inner.close();
  }

  /**
   * Get the underlying inner backend for direct access when needed.
   */
  getInner(): VectorBackend {
    return this.inner;
  }

  /**
   * Get the mutation guard instance.
   */
  getGuard(): MutationGuard {
    return this.guard;
  }

  /**
   * Get the attestation log instance, if configured.
   */
  getLog(): AttestationLog | undefined {
    return this.log;
  }
}
