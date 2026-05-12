/**
 * Backend Detection - Auto-detect available vector backends
 *
 * Detection priority:
 * 1. RuVector (@ruvector/core) - preferred for performance
 *
 * Additional features detected:
 * - @ruvector/gnn - GNN learning capabilities
 *
 * ADR-0170 Phase D (2026-05-12):
 *   HNSWLib + @ruvector/graph-node detection retired (deps removed). The
 *   detector's HNSWLib fallback path is gone; `detectBackend` now throws
 *   when ruvector is unavailable (no silent further fallback, per
 *   feedback-no-fallbacks). The 'hnswlib' value of `BackendType` is
 *   retained for legacy compat but never produced by `detectBackend()`.
 *   `validateBackend('hnswlib', ...)` throws the Phase D retired-message.
 */

/**
 * Backend type identifier.
 *
 * `'hnswlib'` is retained for downstream-type compat; it can be requested
 * via `validateBackend` (which throws) but is never returned by detection.
 */
export type BackendType = 'ruvector' | 'hnswlib' | 'auto';

/**
 * Platform information
 */
export interface PlatformInfo {
  /** Operating system */
  platform: NodeJS.Platform;

  /** CPU architecture */
  arch: string;

  /** Combined platform identifier (e.g., 'linux-x64', 'darwin-arm64') */
  combined: string;
}

/**
 * Backend detection result
 */
export interface DetectionResult {
  /** Detected backend type */
  backend: 'ruvector' | 'hnswlib';

  /** Available feature flags */
  features: {
    /** GNN learning available */
    gnn: boolean;

    /** Graph database available */
    graph: boolean;

    /** Compression available */
    compression: boolean;
  };

  /** Platform information */
  platform: PlatformInfo;

  /** Whether native bindings are available (vs WASM fallback) */
  native: boolean;

  /** Version information */
  versions?: {
    core?: string;
    gnn?: string;
    graph?: string;
  };
}

/**
 * RuVector availability check result
 */
interface RuVectorAvailability {
  available: boolean;
  native: boolean;
  gnn: boolean;
  graph: boolean;
  version?: string;
}

/**
 * Detect available vector backend and features
 *
 * @returns Detection result with backend type and available features
 */
export async function detectBackend(): Promise<DetectionResult> {
  // Get platform information
  const platform = getPlatformInfo();

  // Check for RuVector (preferred)
  const ruvectorAvailable = await checkRuVector();

  if (ruvectorAvailable.available) {
    return {
      backend: 'ruvector',
      features: {
        gnn: ruvectorAvailable.gnn,
        graph: ruvectorAvailable.graph,
        compression: true, // RuVector always supports compression
      },
      platform,
      native: ruvectorAvailable.native,
      versions: {
        core: ruvectorAvailable.version,
      },
    };
  }

  // ADR-0170 Phase D: HNSWLib fallback retired alongside hnswlib-node dep.
  // Per feedback-no-fallbacks: throw loudly when ruvector is unavailable
  // rather than silently routing somewhere else.
  throw new Error(
    `[AgentDB] No vector backend available. RuVector (@ruvector/core) is required ` +
    `post-ADR-0170 Phase D. Install with: npm install ruvector. ` +
    `The HNSWLib fallback was retired alongside the hnswlib-node optionalDependency.`
  );
}

/**
 * Check RuVector availability and features
 */
async function checkRuVector(): Promise<RuVectorAvailability> {
  try {
    // Try to import @ruvector/core
    const core = await import('@ruvector/core');

    // Check if native bindings are available
    const native = core.isNative?.() ?? false;

    // Get version (if available)
    const version = (core as any).version ?? 'unknown';

    // Check for GNN support
    let gnn = false;
    try {
      await import('@ruvector/gnn');
      gnn = true;
    } catch {
      // GNN not available
    }

    // ADR-0170 Phase D: @ruvector/graph-node retired (resolution-J). The
    // graph feature flag stays false unconditionally.
    const graph = false;

    return {
      available: true,
      native,
      gnn,
      graph,
      version,
    };
  } catch (error) {
    // RuVector not available
    return {
      available: false,
      native: false,
      gnn: false,
      graph: false,
    };
  }
}

// ADR-0170 Phase D: checkHnswlib() removed. The hnswlib-node
// optionalDependency was retired; the detector's HNSWLib branch is gone.

/**
 * Get platform information
 */
function getPlatformInfo(): PlatformInfo {
  return {
    platform: process.platform,
    arch: process.arch,
    combined: `${process.platform}-${process.arch}`,
  };
}

/**
 * Validate requested backend is available
 *
 * @param requested - Requested backend type
 * @param detected - Detected backend from auto-detection
 * @throws Error if requested backend is not available
 */
export function validateBackend(
  requested: BackendType,
  detected: DetectionResult
): void {
  if (requested === 'auto') {
    // Auto-detection always succeeds
    return;
  }

  if (requested === 'ruvector' && detected.backend !== 'ruvector') {
    throw new Error(
      'RuVector backend requested but not available.\n' +
        'Install with: npm install @ruvector/core\n' +
        'See: https://github.com/ruvnet/ruvector'
    );
  }

  if (requested === 'hnswlib') {
    throw new Error(
      `[AgentDB] backend 'hnswlib' is retired (ADR-0170 Phase D). ` +
      `Use 'auto' (cascades through ruvector) or 'postgres' (pgvector HNSW).`
    );
  }
}

/**
 * Get recommended backend for a given use case
 *
 * @param useCase - Use case identifier
 * @returns Recommended backend type
 */
export function getRecommendedBackend(useCase: string): BackendType {
  const useCaseLower = useCase.toLowerCase();

  // RuVector recommended for advanced features
  if (
    useCaseLower.includes('learning') ||
    useCaseLower.includes('gnn') ||
    useCaseLower.includes('graph') ||
    useCaseLower.includes('compression')
  ) {
    return 'ruvector';
  }

  // Auto-detection for general use
  return 'auto';
}

/**
 * Format detection result for display
 *
 * @param result - Detection result
 * @returns Formatted string for console output
 */
export function formatDetectionResult(result: DetectionResult): string {
  const lines: string[] = [];

  lines.push('📊 Backend Detection Results:');
  lines.push('');
  lines.push(`  Backend:     ${result.backend}`);
  lines.push(`  Platform:    ${result.platform.combined}`);
  lines.push(`  Native:      ${result.native ? '✅' : '❌ (using WASM)'}`);
  lines.push(`  GNN:         ${result.features.gnn ? '✅' : '❌'}`);
  lines.push(`  Graph:       ${result.features.graph ? '✅' : '❌'}`);
  lines.push(`  Compression: ${result.features.compression ? '✅' : '❌'}`);

  if (result.versions?.core) {
    lines.push(`  Version:     ${result.versions.core}`);
  }

  lines.push('');

  // Add recommendations
  if (result.backend === 'hnswlib') {
    lines.push('💡 Tip: Install @ruvector/core for 150x faster performance');
    lines.push('   npm install @ruvector/core');
  } else if (!result.features.gnn) {
    lines.push('💡 Tip: Install @ruvector/gnn for adaptive learning');
    lines.push('   npm install @ruvector/gnn');
  }

  return lines.join('\n');
}
