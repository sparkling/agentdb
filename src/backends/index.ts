/**
 * AgentDB Backends - Unified Vector Storage Interface
 *
 * Provides automatic backend selection between RuVector (preferred) and
 * RVF, with clear error messages and no silent fallback.
 *
 * ADR-0170 Phase D (2026-05-12):
 *   HNSWLibBackend export removed alongside the deletion of
 *   `backends/hnswlib/`. Downstream consumers that imported it must
 *   migrate to RuVector (in-memory HNSW) or PostgresBackend + pgvector
 *   (relational substrate with HNSW index integrated into the planner).
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
