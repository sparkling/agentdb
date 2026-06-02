/**
 * Backend Factory - Automatic Backend Detection and Selection
 *
 * Detects available vector backends and creates appropriate instances.
 * Priority: RuVector (native/WASM) > RVF (native/WASM) > HNSWLib (Node.js)
 *
 * Features:
 * - Automatic detection of @ruvector and @ruvector/rvf packages
 * - Native vs WASM detection for RuVector and RVF
 * - GNN and Graph capabilities detection
 * - Graceful fallback chain: RuVector -> RVF -> HNSWLib
 * - Clear error messages for missing dependencies
 */

import type { VectorBackend, VectorConfig } from './VectorBackend.js';
import type { SelfLearningConfig } from './rvf/SelfLearningRvfBackend.js';
import { RuVectorBackend } from './ruvector/RuVectorBackend.js';
import { deriveHNSWParams } from '../core/config-chain.js';

// Note: HNSWLibBackend and RvfBackend are lazy-loaded to avoid import failures
// on systems without build tools. The imports happen in helper functions.

export type BackendType = 'auto' | 'ruvector' | 'rvf' | 'hnswlib';

export interface RvfDetection {
  sdk: boolean;
  node: boolean;
  wasm: boolean;
}

export interface BackendDetection {
  available: 'ruvector' | 'rvf' | 'hnswlib' | 'sqljsrvf' | 'none';
  ruvector: {
    core: boolean;
    gnn: boolean;
    graph: boolean;
    native: boolean;
  };
  rvf: RvfDetection;
  hnswlib: boolean;
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
      native: false
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
    // Try main ruvector package first
    const ruvector = await import('ruvector');
    result.ruvector.core = true;
    result.ruvector.gnn = true; // Main package includes GNN
    result.ruvector.graph = true; // Main package includes Graph
    result.ruvector.native = ruvector.isNative?.() ?? false;
    result.available = 'ruvector';
  } catch {
    // Try scoped packages as fallback
    try {
      const core = await import('@ruvector/core');
      result.ruvector.core = true;
      result.ruvector.native = core.isNative?.() ?? false;
      result.available = 'ruvector';

      // Check optional packages
      try {
        await import('@ruvector/gnn');
        result.ruvector.gnn = true;
      } catch {
        // GNN not installed - this is optional
      }

      try {
        await import('@ruvector/graph-node');
        result.ruvector.graph = true;
      } catch {
        // Graph not installed - this is optional
      }
    } catch {
      // RuVector not installed - will try RVF or HNSWLib fallback
    }
  }

  // Check RVF SDK (@ruvector/rvf with N-API or WASM backend)
  try {
    await import('@ruvector/rvf');
    result.rvf.sdk = true;

    // Check for N-API native backend
    try {
      await import('@ruvector/rvf-node');
      result.rvf.node = true;
    } catch {
      // N-API backend not available
    }

    // Check for WASM backend
    try {
      await import('@ruvector/rvf-wasm');
      result.rvf.wasm = true;
    } catch {
      // WASM backend not available
    }

    if (result.available === 'none') {
      result.available = 'rvf';
    }
  } catch {
    // RVF SDK not installed
  }

  // Check HNSWLib
  try {
    await import('hnswlib-node');
    result.hnswlib = true;

    if (result.available === 'none') {
      result.available = 'hnswlib';
    }
  } catch {
    // HNSWLib not installed
  }

  // Check sql.js (always-available built-in RVF fallback)
  try {
    await import('sql.js');
    result.sqljsRvf = true;
    if (result.available === 'none') {
      result.available = 'sqljsrvf';
    }
  } catch {
    result.sqljsRvf = false;
  }

  return result;
}

/**
 * ADR-0246 F-03-003: merge `deriveHNSWParams(config.dimension)` into the
 * caller's config when M/efConstruction/efSearch are omitted. Per
 * `[[reference-embedding-model]]`: mpnet-768 → M:23, efC:100, efS:50.
 * Without this merge, the HNSWLibBackend constructor's static literals
 * (`{M: 16, efConstruction: 200, efSearch: 100}`) silently win for every
 * factory caller that didn't pre-derive — divergent from the canonical
 * `@claude-flow/memory` `resolve-config.ts:328` callers that did.
 *
 * Explicit caller-supplied values win (the spread is `{...derived, ...config}`
 * shape via per-field guards); the merge fires only on `undefined`.
 */
function applyDerivedHNSWParams<C extends VectorConfig>(config: C): C {
  const dim = config.dimension ?? config.dimensions;
  if (!dim) return config; // dimension required — let the backend throw on its own.
  const derived = deriveHNSWParams(dim);
  // Lift M/efConstruction/efSearch only when omitted; preserve every other key.
  return {
    ...config,
    M: config.M ?? derived.M,
    efConstruction: config.efConstruction ?? derived.efConstruction,
    efSearch: config.efSearch ?? derived.efSearch,
  } as C;
}

/**
 * Lazy-load HNSWLibBackend to avoid import failures on systems without build tools
 */
async function createHNSWLibBackend(config: VectorConfig): Promise<VectorBackend> {
  const { HNSWLibBackend } = await import('./hnswlib/HNSWLibBackend.js');
  return new HNSWLibBackend(applyDerivedHNSWParams(config));
}

/**
 * Lazy-load RVF backend wrapped in SelfLearningRvfBackend per upstream ADR-006
 * (`learning?: boolean` default true). Fork ADR-0177 Phase 2 lands the wiring;
 * upstream orphans the wrapper at this factory while ADR-006 sits "Proposed".
 */
async function createRvfBackend(config: VectorConfig): Promise<VectorBackend> {
  const { SelfLearningRvfBackend } = await import('./rvf/SelfLearningRvfBackend.js');
  return SelfLearningRvfBackend.create(applyDerivedHNSWParams(config) as SelfLearningConfig);
}

/**
 * Lazy-load SqlJsRvfBackend - built-in RVF persistence using sql.js WASM.
 * Always available since sql.js is a hard dependency.
 */
async function createSqlJsRvfBackend(config: VectorConfig): Promise<VectorBackend> {
  const { SqlJsRvfBackend } = await import('./rvf/SqlJsRvfBackend.js');
  return new SqlJsRvfBackend(config);
}

/**
 * Create vector backend with automatic detection
 *
 * @param type - Backend type: 'auto', 'ruvector', 'rvf', or 'hnswlib'
 * @param config - Vector configuration
 * @returns Initialized VectorBackend instance
 */
/**
 * ADR-0286: surface a vector-backend FALLBACK loudly. Reaching a non-preferred
 * backend — because the preferred one is unavailable, or because it failed to
 * initialize — changes recall quality / index behavior vs the auto-priority
 * RuVector backend, so an operator must be able to SEE it. The prior silent
 * `console.log` notices hid exactly this (the no-fallbacks invisibility class,
 * ADR-0082, that also hid the SQLite-side P3/P4/P6). INTERIM: loud logging only;
 * the full fail-loud-with-explicit-opt-in is deferred (ADR-0286 — sibling of the
 * SQLite fix `resolveBetterSqlite3LoadFailure` in core/AgentDB.ts).
 */
function warnVectorBackendFallback(message: string): void {
  console.warn(
    `[AgentDB] ⚠ VECTOR-BACKEND FALLBACK — ${message} (not on the preferred backend; see ADR-0286)`,
  );
}

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
    // Try native @ruvector/rvf first, fall back to sql.js-rvf
    if (detection.rvf.sdk) {
      backend = await createRvfBackend(config);
      console.log(
        `[AgentDB] Using RVF backend (${detection.rvf.node ? 'N-API native' : 'WASM'})`
      );
    } else if (detection.sqljsRvf) {
      backend = await createSqlJsRvfBackend(config);
      warnVectorBackendFallback('type="rvf" requested but no native @ruvector/rvf SDK is installed → using the built-in sql.js RVF backend');
    } else {
      throw new Error(
        'RVF backend not available.\n' +
        'Install with: npm install @ruvector/rvf\n' +
        'Native backend: npm install @ruvector/rvf-node\n' +
        'WASM backend: npm install @ruvector/rvf-wasm'
      );
    }
  } else if (type === 'hnswlib') {
    if (!detection.hnswlib) {
      throw new Error(
        'HNSWLib not available.\n' +
        'Install with: npm install hnswlib-node'
      );
    }
    backend = await createHNSWLibBackend(config);
  } else {
    // Auto-detect best available backend (priority: ruvector > rvf > hnswlib)
    if (detection.ruvector.core) {
      backend = new RuVectorBackend(config);
      console.log(
        `[AgentDB] Using RuVector backend (${detection.ruvector.native ? 'native' : 'WASM'})`
      );

      // Try to initialize RuVector, fallback to RVF then HNSWLib if it fails
      try {
        await (backend as unknown as { initialize(): Promise<void> }).initialize();
        return backend;
      } catch (error) {
        const errorMessage = (error as Error).message;

        // Try RVF as first fallback
        if (detection.rvf.sdk) {
          warnVectorBackendFallback('RuVector initialization FAILED → trying the RVF backend');
          console.warn(`[AgentDB]   ↳ RuVector failure reason: ${errorMessage.split('\n')[0]}`);
          try {
            backend = await createRvfBackend(config);
            await (backend as unknown as { initialize(): Promise<void> }).initialize();
            warnVectorBackendFallback(`using the RVF backend (${detection.rvf.node ? 'N-API' : 'WASM'}) after RuVector init failure`);
            return backend;
          } catch {
            // RVF also failed, try HNSWLib
          }
        }

        // Try HNSWLib as next fallback
        if (detection.hnswlib) {
          warnVectorBackendFallback('RVF unavailable or also failed → falling back to HNSWLib');
          backend = await createHNSWLibBackend(config);
        } else if (detection.sqljsRvf) {
          warnVectorBackendFallback('RVF and HNSWLib unavailable → falling back to the built-in sql.js RVF backend');
          backend = await createSqlJsRvfBackend(config);
        } else {
          throw error;
        }
      }
    } else if (detection.rvf.sdk) {
      backend = await createRvfBackend(config);
      warnVectorBackendFallback(`RuVector (@ruvector/core) not installed → using the RVF backend (${detection.rvf.node ? 'N-API native' : 'WASM'})`);
    } else if (detection.hnswlib) {
      backend = await createHNSWLibBackend(config);
      warnVectorBackendFallback('RuVector and RVF not installed → using the HNSWLib backend');
    } else if (detection.sqljsRvf) {
      backend = await createSqlJsRvfBackend(config);
      warnVectorBackendFallback('only the built-in sql.js RVF backend is available (no native RuVector/RVF/HNSWLib) → using it');
    } else {
      throw new Error(
        'No vector backend available.\n' +
        'Install one of:\n' +
        '  - npm install @ruvector/core (recommended)\n' +
        '  - npm install @ruvector/rvf (single-file format)\n' +
        '  - npm install hnswlib-node (fallback)'
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
 * Get recommended backend type based on environment
 */
export async function getRecommendedBackend(): Promise<BackendType> {
  const detection = await detectBackends();

  if (detection.ruvector.core) {
    return 'ruvector';
  } else if (detection.rvf.sdk) {
    return 'rvf';
  } else if (detection.hnswlib) {
    return 'hnswlib';
  } else {
    return 'auto';
  }
}

/**
 * Check if a specific backend is available
 */
export async function isBackendAvailable(backend: 'ruvector' | 'rvf' | 'hnswlib'): Promise<boolean> {
  const detection = await detectBackends();

  if (backend === 'ruvector') {
    return detection.ruvector.core;
  }
  if (backend === 'rvf') {
    return detection.rvf.sdk;
  }

  return detection.hnswlib;
}

/**
 * Get installation instructions for a backend
 */
export function getInstallCommand(backend: 'ruvector' | 'rvf' | 'hnswlib'): string {
  if (backend === 'ruvector') return 'npm install ruvector';
  if (backend === 'rvf') return 'npm install @ruvector/rvf @ruvector/rvf-node';
  return 'npm install hnswlib-node';
}
