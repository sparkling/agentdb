/**
 * AgentDB Backends - Unified Vector Storage Interface
 *
 * Provides automatic backend selection between RuVector and HNSWLib
 * with graceful fallback and clear error messages.
 */

// Core interfaces
export type {
  VectorBackend,
  VectorConfig,
  SearchResult,
  SearchOptions,
  VectorStats
} from './VectorBackend.js';

// Backend implementations
export { RuVectorBackend } from './ruvector/RuVectorBackend.js';
export { RuVectorLearning } from './ruvector/RuVectorLearning.js';
export { HNSWLibBackend } from './hnswlib/HNSWLibBackend.js';
// ADR-0181 Phase 1: the archivist's `ArchivistInitConfig.rvfBackend` is typed
// against this concrete class, so host processes that wire a real RVF substrate
// must be able to import it. Previously it was only reachable internally via
// `factory.ts`'s lazy loader. `RvfConfig` rides along — it is `RvfBackend`'s
// constructor argument type.
export { RvfBackend } from './rvf/RvfBackend.js';
export type { RvfConfig } from './rvf/RvfBackend.js';

// Factory and detection
export {
  createBackend,
  detectBackends,
  getRecommendedBackend,
  isBackendAvailable,
  getInstallCommand
} from './factory.js';

export type { BackendType, BackendDetection } from './factory.js';
export type { LearningConfig, EnhancementOptions } from './ruvector/RuVectorLearning.js';
