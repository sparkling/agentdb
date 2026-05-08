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

// Core controllers
export { CausalMemoryGraph } from './controllers/CausalMemoryGraph.js';
export { CausalRecall } from './controllers/CausalRecall.js';
export { ExplainableRecall } from './controllers/ExplainableRecall.js';
export { NightlyLearner } from './controllers/NightlyLearner.js';
export { ReflexionMemory } from './controllers/ReflexionMemory.js';
export { SkillLibrary } from './controllers/SkillLibrary.js';
export { LearningSystem } from './controllers/LearningSystem.js';
export { ReasoningBank } from './controllers/ReasoningBank.js';

// Embedding services
export { EmbeddingService } from './controllers/EmbeddingService.js';
export { EnhancedEmbeddingService } from './controllers/EnhancedEmbeddingService.js';

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

// Optimizations
export { BatchOperations } from './optimizations/BatchOperations.js';
export { QueryOptimizer } from './optimizations/QueryOptimizer.js';
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

// Re-export all controllers for convenience (also brings in MutationGuard,
// AttestationLog, GuardedVectorBackend, vector-math, prerequisites — see
// controllers/index.ts merge per ADR-0161)
export * from './controllers/index.js';

// LLM Router - Multi-provider LLM integration with RuvLLM support
export {
  LLMRouter,
  isRuvLLMInstalled,
  type LLMConfig,
  type LLMResponse,
} from './services/LLMRouter.js';

// ============================================================================
// Fork-side additions (ADR-0161 three-way merge — preserve alpha.14 above
// AND add fork-side net-new exports below)
// ============================================================================

// Optimizations — RVFOptimizer (lifted in d7ca0f6)
export { RVFOptimizer } from './optimizations/RVFOptimizer.js';
export type { RVFConfig } from './optimizations/RVFOptimizer.js';

// Security infrastructure (ADR-0061 Phase 0)
export { ResourceTracker, RateLimiter, CircuitBreaker, SecurityError } from './security/limits.js';

// Observability — telemetry
export { TelemetryManager } from './observability/telemetry.js';
export type { TelemetryConfig } from './observability/telemetry.js';

// Services — RuVector package integrations (lifted fork-only files)
export { SemanticRouter } from './services/SemanticRouter.js';
export { SonaTrajectoryService } from './services/SonaTrajectoryService.js';
export { GraphTransformerService } from './services/GraphTransformerService.js';
export { GNNService } from './services/GNNService.js';
export type { RouteResult, RouteConfig } from './services/SemanticRouter.js';
export type { TrajectoryStep, StoredTrajectory, PredictionResult, SonaStats } from './services/SonaTrajectoryService.js';
export type { GraphTransformerStats } from './services/GraphTransformerService.js';
export type { GNNConfig, IntentResult } from './services/GNNService.js';

// Consensus — Distributed coordination (lifted fork-only file, TODO-guarded)
export { RaftConsensus } from './consensus/RaftConsensus.js';
export type { RaftConfig, LogEntry, RaftState } from './consensus/RaftConsensus.js';

// Thompson Sampling bandit (RVF backend)
export { SolverBandit } from './backends/rvf/SolverBandit.js';
export type { BanditArmStats, BanditConfig, BanditStats, BanditState } from './backends/rvf/SolverBandit.js';

// Attention metrics (ADR-0050)
export { AttentionMetricsCollector } from './utils/attention-metrics.js';
export type { AttentionMetrics as ForkAttentionMetrics, OperationMetrics } from './utils/attention-metrics.js';

// Index health monitoring (ADR-0050)
export { IndexHealthMonitor } from './backends/rvf/AdaptiveIndexTuner.js';

// Audit logging (ADR-0050)
export { AuditLogger } from './services/audit-logger.service.js';
export type { AuditEventType, AuditEvent } from './services/audit-logger.service.js';

// Federated learning (ADR-0050)
export { FederatedLearningManager } from './services/federated-learning.js';
export type { FederatedAgentState, FederatedConfig } from './services/federated-learning.js';

// Self-learning RVF backend (ADR-0050)
export { SelfLearningRvfBackend } from './backends/rvf/SelfLearningRvfBackend.js';
export type { SelfLearningConfig } from './backends/rvf/SelfLearningRvfBackend.js';

// Native accelerator — JS fallback singleton (ADR-0050)
export { NativeAccelerator, getAccelerator, resetAccelerator } from './backends/rvf/NativeAccelerator.js';

// Embedding config (ADR-0052 / ADR-0069 config-driven framework)
export { getEmbeddingConfig, resetEmbeddingConfig, getModelDimension, getTaskPrefix, applyTaskPrefix, deriveHNSWParams, MODEL_REGISTRY } from './config/embedding-config.js';
export type { EmbeddingConfig as ForkEmbeddingConfig, HNSWParams, ModelInfo } from './config/embedding-config.js';
