/**
 * Backend Factory - Automatic Backend Detection and Selection
 *
 * Detects available vector backends and creates appropriate instances.
 * Priority: RuVector (native/WASM) > RVF (native/WASM)
 *
 * Features:
 * - Automatic detection of @ruvector and @ruvector/rvf packages
 * - Native vs WASM detection for RuVector and RVF
 * - GNN capability detection
 * - Graceful fallback chain: RuVector -> RVF
 * - Clear error messages for missing dependencies
 *
 * ADR-0170 Phase D (2026-05-12):
 *   HNSWLibBackend was deleted alongside the `hnswlib-node` optionalDep.
 *   The 'hnswlib' value of BackendType is retained as a loud-rejection
 *   target (loud throw at boot) so calls passing 'hnswlib' get a clear
 *   ADR-0170 marker instead of silently routing somewhere else. Same
 *   pattern is applied to @ruvector/graph-node (retired alongside the
 *   `enableGraph` config field — see Phase B resolution-J).
 */

import type { VectorBackend, VectorConfig } from './VectorBackend.js';
import { RuVectorBackend } from './ruvector/RuVectorBackend.js';
import { GuardedVectorBackend, ProofDeniedError } from './ruvector/GuardedVectorBackend.js';
import { MutationGuard } from '../security/MutationGuard.js';
import { AttestationLog } from '../security/AttestationLog.js';
import { getEmbeddingConfig } from '../config/embedding-config.js';
import {
  PostgresBackend,
  type PostgresBackendConfig,
} from './postgres/PostgresBackend.js';

// Note: RvfBackend is lazy-loaded to avoid import failures when
// @ruvector/rvf is not installed. ADR-0170 Phase D removed HNSWLibBackend
// (orphaned alongside the hnswlib-node optionalDependency).

// ADR-0170 Phase A.3: 'postgres' added to BackendType. The relational
// substrate axis loses 'auto' (per ADR-0170 §Phase A item 3 — no auto-
// cascade for primaryStorage); only vectorIndex retains 'auto' below.
// Phase D: 'hnswlib' is retained as a name-validation target so the
// loud-rejection error message is unambiguous; the actual backend was
// deleted alongside the hnswlib-node dep.
export type BackendType = 'auto' | 'ruvector' | 'rvf' | 'hnswlib' | 'postgres';

export interface RvfDetection {
  sdk: boolean;
  node: boolean;
  wasm: boolean;
}

export interface BackendDetection {
  // ADR-0170 Phase D: 'hnswlib' and 'sqljsrvf' values retired but the
  // union member names stay for downstream-type compat. detectBackends()
  // never returns them post-Phase-D.
  available: 'ruvector' | 'rvf' | 'none';
  ruvector: {
    core: boolean;
    gnn: boolean;
    /** @deprecated ADR-0170 Phase D: graph-node retired; field always false. */
    graph: boolean;
    native: boolean;
    graphTransformer: boolean;
  };
  rvf: RvfDetection;
  /** @deprecated ADR-0170 Phase D: hnswlib-node retired; field always false. */
  hnswlib: boolean;
  /** @deprecated ADR-0170 Phase D: sql.js retired; field always false. */
  sqljsRvf: boolean;
}

/**
 * Detect available vector backends
 */
export async function detectBackends(): Promise<BackendDetection> {
  const result: BackendDetection = {
    available: 'none',
    ruvector: {
      core: false,
      gnn: false,
      graph: false,
      native: false,
      graphTransformer: false,
    },
    rvf: {
      sdk: false,
      node: false,
      wasm: false,
    },
    hnswlib: false,
    sqljsRvf: false,
  };

  // Check RuVector packages (main package or scoped packages)
  try {
    // Try main ruvector package first (v0.1.99+)
    const ruvector = await import('ruvector');
    result.ruvector.core = true;
    result.ruvector.gnn = true; // Main package includes GNN

    // Check for native backend availability (0.1.99+ API)
    if (typeof (ruvector as any).isNative === 'function') {
      result.ruvector.native = (ruvector as any).isNative();
    } else if (typeof (ruvector as any).backend === 'function') {
      // Legacy API check
      const backend = (ruvector as any).backend();
      result.ruvector.native = backend === 'native' || backend === 'napi';
    }

    result.available = 'ruvector';
  } catch {
    // Try scoped packages as fallback
    try {
      const core = await import('@ruvector/core');
      result.ruvector.core = true;

      // Check for native backend (scoped packages)
      if (typeof (core as any).isNative === 'function') {
        result.ruvector.native = (core as any).isNative();
      } else if (typeof (core as any).backend === 'function') {
        const backend = (core as any).backend();
        result.ruvector.native = backend === 'native' || backend === 'napi';
      }

      result.available = 'ruvector';

      // Check optional packages
      try {
        await import('@ruvector/gnn');
        result.ruvector.gnn = true;
      } catch {
        // GNN not installed - this is optional
      }

      // ADR-0170 Phase D: @ruvector/graph-node retired per resolution J.
      // result.ruvector.graph stays false unconditionally.

      try {
        await import('@ruvector/graph-transformer' as string);
        result.ruvector.graphTransformer = true;
      } catch {
        // graph-transformer not installed - optional
      }
    } catch {
      // RuVector not installed - falls through to RVF detection.
    }
  }

  // Check @ruvector/graph-transformer independently (may exist without core)
  if (!result.ruvector.graphTransformer) {
    try {
      await import('@ruvector/graph-transformer' as string);
      result.ruvector.graphTransformer = true;
    } catch {
      // Try WASM version
      try {
        await import('ruvector-graph-transformer-wasm' as string);
        result.ruvector.graphTransformer = true;
      } catch {
        // graph-transformer not installed in any form
      }
    }
  }

  // ADR-0170 Phase D: hnswlib-node and sql.js detection retired.
  // The backends were deleted alongside their npm deps; `result.hnswlib`
  // and `result.sqljsRvf` stay false unconditionally.

  return result;
}

/**
 * Lazy-load RvfBackend to avoid import failures when @ruvector/rvf is not installed
 */
async function createRvfBackend(config: VectorConfig): Promise<VectorBackend> {
  const { RvfBackend } = await import('./rvf/RvfBackend.js');
  return new RvfBackend(config);
}

// ADR-0170 Phase D: createHNSWLibBackend + createSqlJsRvfBackend removed.
// HNSWLibBackend.ts deleted with hnswlib-node optionalDep; SqlJsRvfBackend
// is unreachable post-Phase-D (sql.js removed as runtime dep). The
// vector-index axis cascade no longer includes either backend.

/**
 * Create vector backend with automatic detection
 *
 * @param type - Backend type: 'auto', 'ruvector', 'rvf', or 'hnswlib'
 * @param config - Vector configuration
 * @returns Initialized VectorBackend instance
 */
export async function createBackend(
  type: BackendType,
  config: VectorConfig
): Promise<VectorBackend> {
  const detection = await detectBackends();

  let backend: VectorBackend;

  // Handle explicit backend selection
  if (type === 'ruvector') {
    if (!detection.ruvector.core) {
      throw new Error(
        'RuVector not available.\n' +
        'Install with: npm install @ruvector/core\n' +
        'Optional GNN support: npm install @ruvector/gnn\n' +
        'Optional Graph support: npm install @ruvector/graph-node'
      );
    }
    backend = new RuVectorBackend(config);
  } else if (type === 'rvf') {
    // ADR-0170 Phase D: sql.js RVF tier retired alongside the sql.js dep.
    // Only the native @ruvector/rvf path remains.
    if (detection.rvf.sdk) {
      backend = await createRvfBackend(config);
      console.log(
        `[AgentDB] Using RVF backend (${detection.rvf.node ? 'N-API native' : 'WASM'})`
      );
    } else {
      throw new Error(
        'RVF backend not available.\n' +
        'Install with: npm install @ruvector/rvf\n' +
        'Native backend: npm install @ruvector/rvf-node\n' +
        'WASM backend: npm install @ruvector/rvf-wasm'
      );
    }
  } else if (type === 'hnswlib') {
    // ADR-0170 Phase D: HNSWLibBackend is retired. The hnswlib-node
    // optionalDependency was removed; the in-memory HNSW search axis is
    // replaced by pgvector HNSW indexes on the relational substrate.
    throw new Error(
      `[AgentDB] backend type 'hnswlib' is retired (ADR-0170 Phase D). ` +
      `Use 'auto' (cascades to ruvector/rvf) or 'postgres' (pgvector HNSW). ` +
      `See docs/adr/ADR-0170-agentdb-substrate-replacement-postgresql.md.`
    );
  } else if (type === 'postgres') {
    // ADR-0170 Phase A.3: PostgreSQL substrate (pglite embedded or
    // postgres:// server). The factory creates the backend and the
    // PostgresBackend constructor throws loudly on legacy SQLite files,
    // missing pglite imports, or unreachable connectionString — see
    // PostgresBackend.ts for the fail-loud gates.
    //
    // Note: 'postgres' is the relational substrate (primaryStorage axis).
    // It does NOT auto-cascade — passing primaryStorage='auto' is
    // rejected at config validation time (AgentDB.initialize). Only the
    // vector-index axis retains 'auto' detection.
    backend = new PostgresBackend(config as PostgresBackendConfig);
  } else {
    // ADR-0170 Phase A.3: 'auto' is the vector-index auto-cascade only.
    // The relational substrate axis (primaryStorage) no longer has an
    // auto-cascade — AgentDBConfig validation rejects primaryStorage='auto'
    // at boot. For the vector-index axis, Phase C will add 'pgvector' as
    // the preferred winner once pgvector tables exist; in Phase A the
    // cascade order remains ruvector > rvf > hnswlib > sqljsRvf.
    //
    // ADR-0170 Phase D: cascade pruned to ruvector > rvf. HNSWLib and
    // sql.js RVF tiers removed alongside the hnswlib-node + sql.js deps.
    // Auto-detect best available backend (priority: ruvector > rvf)
    if (detection.ruvector.core) {
      backend = new RuVectorBackend(config);
      const backendType = detection.ruvector.native ? 'native NAPI-RS' : 'WASM';
      const proofStatus = detection.ruvector.graphTransformer
        ? '+ graph-transformer proofs'
        : '(no proof engine)';
      console.log(`[AgentDB] Using RuVector backend (${backendType}) ${proofStatus}`);

      // Try to initialize RuVector, fallback to RVF if it fails
      try {
        await (backend as unknown as { initialize(): Promise<void> }).initialize();
        return backend;
      } catch (error) {
        const errorMessage = (error as Error).message;

        // Try RVF as fallback (final tier post-Phase-D cleanup)
        if (detection.rvf.sdk) {
          console.log('[AgentDB] RuVector initialization failed, trying RVF backend');
          console.log(`[AgentDB] Reason: ${errorMessage.split('\n')[0]}`);
          backend = await createRvfBackend(config);
          await (backend as unknown as { initialize(): Promise<void> }).initialize();
          console.log(`[AgentDB] Using RVF backend (${detection.rvf.node ? 'N-API' : 'WASM'} fallback)`);
          return backend;
        }

        // Per feedback-no-fallbacks: no silent further fallback. Re-throw
        // the original ruvector init error so the operator sees it.
        throw error;
      }
    } else if (detection.rvf.sdk) {
      backend = await createRvfBackend(config);
      console.log(`[AgentDB] Using RVF backend (${detection.rvf.node ? 'N-API native' : 'WASM'})`);
    } else {
      throw new Error(
        'No vector backend available.\n' +
        'Install one of:\n' +
        '  - npm install ruvector@0.1.99+ (recommended, includes native NAPI-RS)\n' +
        '  - npm install @ruvector/core (alternative)\n' +
        '  - npm install @ruvector/rvf (RVF tier — final fallback after Phase D)'
      );
    }
  }

  // Initialize the backend (if not already initialized)
  try {
    await (backend as unknown as { initialize(): Promise<void> }).initialize();
  } catch (error) {
    if (!(error as Error).message.includes('already initialized')) {
      throw error;
    }
  }

  return backend;
}

/**
 * Get recommended backend type based on environment.
 *
 * ADR-0170 Phase D: 'hnswlib' branch removed (backend retired).
 */
export async function getRecommendedBackend(): Promise<BackendType> {
  const detection = await detectBackends();

  if (detection.ruvector.core) {
    return 'ruvector';
  } else if (detection.rvf.sdk) {
    return 'rvf';
  } else {
    return 'auto';
  }
}

/**
 * Check if a specific backend is available.
 *
 * ADR-0170 Phase D: 'hnswlib' branch always returns false (backend retired).
 */
export async function isBackendAvailable(backend: 'ruvector' | 'rvf' | 'hnswlib'): Promise<boolean> {
  const detection = await detectBackends();

  if (backend === 'ruvector') {
    return detection.ruvector.core;
  }
  if (backend === 'rvf') {
    return detection.rvf.sdk;
  }
  // 'hnswlib' — retired post-Phase-D.
  return false;
}

/**
 * Get installation instructions for a backend.
 *
 * ADR-0170 Phase D: 'hnswlib' branch returns a retired-message instead of
 * a fictional install command.
 */
export function getInstallCommand(backend: 'ruvector' | 'rvf' | 'hnswlib'): string {
  if (backend === 'ruvector') return 'npm install ruvector';
  if (backend === 'rvf') return 'npm install @ruvector/rvf @ruvector/rvf-node';
  return '# hnswlib backend retired in ADR-0170 Phase D — use ruvector or pgvector';
}

// Re-export proof-gated types (ADR-060)
export { GuardedVectorBackend, ProofDeniedError };

/**
 * Create a proof-gated vector backend (ADR-060)
 *
 * Wraps a standard VectorBackend with MutationGuard to require
 * cryptographic proofs for all mutating operations. Optionally
 * attaches an AttestationLog when a database handle is provided.
 *
 * @param type - Backend type: 'auto', 'ruvector', or 'hnswlib'
 * @param config - Vector configuration with optional database handle
 * @returns Object containing the guarded backend, guard, and optional log
 */
export async function createGuardedBackend(
  type: BackendType,
  config: VectorConfig & { database?: any; enableProofs?: boolean }
): Promise<{ backend: GuardedVectorBackend; guard: MutationGuard; log: AttestationLog | null }> {
  const detection = await detectBackends();
  const inner = await createBackend(type, config);

  // Enable proofs if graph-transformer is available or explicitly requested
  const enableWasmProofs = config.enableProofs ?? detection.ruvector.graphTransformer ?? true;

  const guard = new MutationGuard({
    dimension: config.dimension ?? config.dimensions ?? getEmbeddingConfig().dimension,
    maxElements: config.maxElements ?? getEmbeddingConfig().maxElements, // ADR-0069: config-chain capacity
    enableWasmProofs,
    enableAttestationLog: true,
    defaultNamespace: 'default',
  });
  await guard.initialize();

  // Log the proof engine status
  const stats = guard.getStats();
  console.log(`[GuardedBackend] Proof engine: ${stats.engineType}, WASM available: ${stats.wasmAvailable}`);

  let log: AttestationLog | null = null;
  if (config.database) {
    log = new AttestationLog(config.database);
  }

  return { backend: new GuardedVectorBackend(inner, guard, log ?? undefined), guard, log };
}
