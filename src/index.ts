/**
 * AgentDB - Main Entry Point
 *
 * Frontier Memory Features with MCP Integration:
 * - Causal reasoning and memory graphs
 * - Reflexion memory with self-critique
 * - Skill library with automated learning
 * - Vector search with embeddings
 * - Reinforcement learning (9 algorithms)
 */

// Main AgentDB class
export { AgentDB } from './core/AgentDB.js';
import { AgentDB as AgentDBClass } from './core/AgentDB.js';
export default AgentDBClass;

// ADR-0177 Phase 1.6: canonical config-chain accessor + typed errors.
// `getEmbeddingConfig` lets `@claude-flow/memory/resolve-config.ts` layer its
// overrides on top without importing memory back (which would be a cycle).
// ADR-0065 P3-3: deriveHNSWParams re-exported here so @claude-flow/memory's
// agentdb-backend can optionally wire it without a hard dep on memory.
export {
  getConfig,
  getEmbeddingConfig,
  resetConfig,
  isConfigOnDisk,
  validateBoot,
  ConfigChainValidationError,
  EmbeddingDimensionMismatchError,
  deriveHNSWParams,
  type ConfigChain,
  type EmbeddingChainConfig,
} from './core/config-chain.js';

// ADR-0061 Phase 0: resource/rate/circuit/telemetry controllers that the
// memory controller-registry imports from agentdb at bootstrap. Exporting
// from the barrel so consumers can resolve the symbols without digging into
// security/observability sub-paths.
export { ResourceTracker, RateLimiter, CircuitBreaker } from './security/limits.js';
export { TelemetryManager } from './observability/telemetry.js';

// Core controllers
export { CausalMemoryGraph } from './controllers/CausalMemoryGraph.js';
export { CausalRecall } from './controllers/CausalRecall.js';
export { ExplainableRecall } from './controllers/ExplainableRecall.js';
export { NightlyLearner } from './controllers/NightlyLearner.js';
export { ReflexionMemory } from './controllers/ReflexionMemory.js';
export { SkillLibrary } from './controllers/SkillLibrary.js';
export { LearningSystem } from './controllers/LearningSystem.js';
export { ReasoningBank } from './controllers/ReasoningBank.js';
// HierarchicalMemory: fork-only controller from ADR-066 (3-tier working/episodic/semantic). Restored 2026-05-12 from archive/pre-adr-0177-reset-2026-05-12 (commit bd760f2, pre-ADR-0170 RVF/sqlite-vec era; postgres-backed evolution explicitly skipped per ADR-0177).
export { HierarchicalMemory } from './controllers/HierarchicalMemory.js';
// MemoryConsolidation: fork-only controller, natural pair with HierarchicalMemory. Restored 2026-05-12 from bd760f2 (same pre-ADR-0170 snapshot as HierarchicalMemory). Implements tier-transition logic (working→episodic→semantic) driven by access count + importance + age. Consumed by controller-registry.ts:715 case 'memoryConsolidation'.
export { MemoryConsolidation } from './controllers/MemoryConsolidation.js';

// Embedding services
export { EmbeddingService } from './controllers/EmbeddingService.js';
export { EnhancedEmbeddingService } from './controllers/EnhancedEmbeddingService.js';
// StreamingEmbeddingService: fork-only controller (ADR-065 P1-3). Restored 2026-05-12 from bd760f2 (pre-ADR-0170 RVF/sqlite-vec era). Streaming variant with chunk-by-chunk incremental embedding generation, progress callbacks, and AbortController-based cancellation. Zero in-tree consumers today; documented as orphan in ADR-0171; restored to preserve future-wiring optionality per ADR-0178 Follow-up #4.
export { StreamingEmbeddingService } from './controllers/StreamingEmbeddingService.js';

// Model cache (offline .rvf model loading)
export { ModelCacheLoader } from './model/ModelCacheLoader.js';

// WASM acceleration and HNSW indexing
export { WASMVectorSearch } from './controllers/WASMVectorSearch.js';
export { HNSWIndex, isHnswlibAvailable } from './controllers/HNSWIndex.js';

// Attention mechanisms
export { AttentionService } from './controllers/AttentionService.js';

// Memory Controller with Attention Integration
export { MemoryController } from './controllers/MemoryController.js';

// Attention Controllers
export { SelfAttentionController } from './controllers/attention/SelfAttentionController.js';
export { CrossAttentionController } from './controllers/attention/CrossAttentionController.js';
export { MultiHeadAttentionController } from './controllers/attention/MultiHeadAttentionController.js';

// Database utilities
export { createDatabase } from './db-fallback.js';

// SolverBandit: Thompson Sampling bandit for controller decisions (controller-registry.ts L1 solverBandit)
export { SolverBandit } from './backends/rvf/SolverBandit.js';

// Optimizations
export { BatchOperations } from './optimizations/BatchOperations.js';
export { QueryOptimizer } from './optimizations/QueryOptimizer.js';
// RVFOptimizer: fork-only optimization (ADR-062, ADR-065). Restored 2026-05-12 from bd760f2 (pre-ADR-0170 RVF/sqlite-vec era). Implements 4/8/16-bit quantization, dedup, pruning, batch embedding, LRU caching, adaptive + progressive compression. controller-registry.ts:1721 currently exposes a stats-only wrapper; the restored class is the real implementation behind the wrapper.
export { RVFOptimizer } from './optimizations/RVFOptimizer.js';
export { QueryCache } from './core/QueryCache.js';
export type { QueryCacheConfig, CacheEntry, CacheStatistics } from './core/QueryCache.js';

// Security
export {
  validateTableName,
  validateColumnName,
  validatePragmaCommand,
  buildSafeWhereClause,
  buildSafeSetClause,
  ValidationError,
} from './security/input-validation.js';

// Vector Quantization
export {
  // Types
  type QuantizationStats,
  type QuantizedVector,
  type ProductQuantizerConfig,
  type PQEncodedVector,
  type QuantizedVectorStoreConfig,
  type QuantizedSearchResult,
  // Scalar Quantization
  quantize8bit,
  quantize4bit,
  dequantize8bit,
  dequantize4bit,
  calculateQuantizationError,
  getQuantizationStats,
  // Product Quantization
  ProductQuantizer,
  // Quantized Vector Store
  QuantizedVectorStore,
  // Factory Functions
  createScalar8BitStore,
  createScalar4BitStore,
  createProductQuantizedStore,
} from './quantization/index.js';

// Hybrid Search (Vector + Keyword)
export {
  KeywordIndex,
  HybridSearch,
  createKeywordIndex,
  createHybridSearch,
  type HybridSearchOptions,
  type HybridSearchResult,
  type HybridQuery,
  type BM25Config,
} from './search/index.js';

// Benchmarking Suite
export {
  // Main Suite
  BenchmarkSuite,
  // Base class for custom benchmarks
  Benchmark,
  // Built-in benchmarks
  VectorInsertBenchmark,
  VectorSearchBenchmark,
  MemoryUsageBenchmark,
  ConcurrencyBenchmark,
  QuantizationBenchmark,
  // CLI integration functions
  runBenchmarks,
  runSelectedBenchmarks,
  // Formatting utilities
  formatReportAsMarkdown,
  formatComparisonAsMarkdown,
  // Types
  type LatencyStats,
  type BenchmarkResult,
  type BenchmarkReport,
  type ComparisonReport,
  type BenchmarkConfig,
} from './benchmark/index.js';

// Re-export all controllers for convenience
export * from './controllers/index.js';

// QUIC sync types + CRDT primitives — ADR-0196 Phase 5 federation interface
// needs `VectorClock` + `incrementVectorClock` at the top-level so agentic-flow's
// `FederatedSyncProvider` can populate episode identity without reaching into
// agentdb's subpath imports.
export type {
  VectorClock,
  VectorClockComparison,
  SyncMessage,
  SyncPayload,
  EpisodeSync,
  SyncableEpisode,
} from './types/quic.js';
export {
  incrementVectorClock,
  createVectorClock,
  compareVectorClocks,
  mergeVectorClocks,
} from './types/quic.js';

// LLM Router - Multi-provider LLM integration with RuvLLM support
export {
  LLMRouter,
  isRuvLLMInstalled,
  type LLMConfig,
  type LLMResponse,
} from './services/LLMRouter.js';

// Fork-only services restored 2026-05-12 from bd760f2 (pre-ADR-0170 RVF era) per ADR-0178 Follow-up #4.
// SonaTrajectoryService: SONA-based agent trajectory recording + prediction (@ruvector/sona wrapper with in-memory fallback). controller-registry.ts:1450 expects this export.
export { SonaTrajectoryService } from './services/SonaTrajectoryService.js';
// SemanticRouter: semantic intent routing via @ruvector/router with keyword-matching fallback (ADR-062). controller-registry.ts:1418 expects this export.
export { SemanticRouter } from './services/SemanticRouter.js';
// GNNService: Graph Neural Network service (@ruvector/gnn wrapper with JS fallback). Provides intent classification, skill recommendation, code pattern similarity (ADR-062). controller-registry.ts:1711 expects this export.
export { GNNService } from './services/GNNService.js';
// GraphTransformerService: 8-module graph attention service (@ruvector/graph-transformer wrapper) — sublinear/causal/Granger/Hamiltonian/spiking/game-theoretic attention + product manifold distance (ADR-060 Phase 3). controller-registry.ts:1534 case 'graphTransformer' routes through agentdb.getController which depends on this controller's registration.
export { GraphTransformerService } from './services/GraphTransformerService.js';
