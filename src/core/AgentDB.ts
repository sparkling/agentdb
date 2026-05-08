/**
 * AgentDB v3 - Main database wrapper class
 *
 * Provides a unified interface to all AgentDB controllers with
 * proof-gated mutations via MutationGuard and @ruvector/graph-transformer.
 */
import { ReflexionMemory } from '../controllers/ReflexionMemory.js';
import { SkillLibrary } from '../controllers/SkillLibrary.js';
import { ReasoningBank } from '../controllers/ReasoningBank.js';
import { CausalMemoryGraph } from '../controllers/CausalMemoryGraph.js';
import { CausalRecall } from '../controllers/CausalRecall.js';
import { LearningSystem } from '../controllers/LearningSystem.js';
import { ExplainableRecall } from '../controllers/ExplainableRecall.js';
import { NightlyLearner } from '../controllers/NightlyLearner.js';
import { EmbeddingService } from '../controllers/EmbeddingService.js';
import { AttentionService } from '../controllers/AttentionService.js';
import { QueryOptimizer } from '../optimizations/QueryOptimizer.js';
import { BatchOperations } from '../optimizations/BatchOperations.js';
import { HierarchicalMemory } from '../controllers/HierarchicalMemory.js';
import { MemoryConsolidation } from '../controllers/MemoryConsolidation.js';
import { WASMVectorSearch } from '../controllers/WASMVectorSearch.js';
import { AuditLogger } from '../services/audit-logger.service.js';
import { getEmbeddingConfig } from '../config/embedding-config.js';
import { createGuardedBackend } from '../backends/factory.js';
import type { VectorBackend } from '../backends/VectorBackend.js';
import type { GuardedVectorBackend } from '../backends/ruvector/GuardedVectorBackend.js';
import type { MutationGuard } from '../security/MutationGuard.js';
import type { AttestationLog } from '../security/AttestationLog.js';
import { GraphTransformerService } from '../services/GraphTransformerService.js';
// sparkling/agentic-flow W5-A3: SonaTrajectoryService imported at module scope
// so getController('sonaTrajectory') can lazy-instantiate the singleton sync.
import { SonaTrajectoryService } from '../services/SonaTrajectoryService.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AgentDBConfig {
  dbPath?: string;
  namespace?: string;
  dimension?: number;
  maxElements?: number;
  enableAttention?: boolean;
  attentionConfig?: Record<string, any>;
  /** Force use of sql.js WASM even if better-sqlite3 is available */
  forceWasm?: boolean;
  /** Vector backend type: 'auto' | 'ruvector' | 'hnswlib' */
  vectorBackend?: 'auto' | 'ruvector' | 'hnswlib';
  /** Vector dimension (default: 768 for nomic-embed-text-v1.5) */
  vectorDimension?: number;
  /** Embedding model ID (default: 'nomic-ai/nomic-embed-text-v1.5') */
  embeddingModel?: string;
  /** HNSW M parameter - connections per layer (forwarded to vector backend) */
  hnswM?: number;
  /** HNSW efConstruction - build quality (forwarded to vector backend) */
  hnswEfConstruction?: number;
  /** HNSW efSearch - search quality (forwarded to vector backend) */
  hnswEfSearch?: number;
  /** ADR-0069 A1: config-chain SQLite pragmas */
  sqlite?: {
    cacheSize?: number;      // default: -64000 (64MB)
    busyTimeoutMs?: number;  // default: 5000
    journalMode?: string;    // default: 'WAL'
    synchronous?: string;    // default: 'NORMAL'
  };
  /** Enable graph database adapter (creates .graph file). Default: false */
  enableGraph?: boolean;
}

export class AgentDB {
  private db: any;
  private reflexion!: ReflexionMemory;
  private skills!: SkillLibrary;
  private reasoning!: ReasoningBank;
  private causalGraph!: CausalMemoryGraph;
  private causalRecall!: CausalRecall;
  private learningSystem!: LearningSystem;
  private explainableRecall!: ExplainableRecall;
  private nightlyLearner!: NightlyLearner;
  private embedder!: EmbeddingService;
  private vectorBackend!: VectorBackend;
  private guardedBackend: GuardedVectorBackend | null = null;
  private mutationGuard: MutationGuard | null = null;
  private attestationLog: AttestationLog | null = null;
  private graphTransformer!: GraphTransformerService;
  private graphAdapter: any = null;
  private attentionService: AttentionService | null = null;
  private queryOptimizer?: QueryOptimizer;
  private auditLogger?: AuditLogger;
  private batchOperations?: BatchOperations;
  private hierarchicalMemory?: HierarchicalMemory;
  private memoryConsolidation?: MemoryConsolidation;
  // sparkling/agentic-flow#6: lazy singleton for WASM vector search
  private wasmVectorSearch: any = null;
  // ADR-0069 F1: Phase 2 RuVector controllers (set externally or null)
  private gnnLearning: any = null;
  private semanticRouter: any = null;
  private sonaService: any = null;
  private initialized = false;
  private config: AgentDBConfig;
  private usingWasm = false;

  constructor(config: AgentDBConfig = {}) {
    this.config = config;
    // db initialized in initialize() after dynamic import
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Dynamic import: try better-sqlite3 (native), fallback to sql.js (WASM)
    const dbPath = this.config.dbPath || ':memory:';
    // ADR-0069 A1: config-chain SQLite pragmas
    const sq = this.config.sqlite;
    try {
      const Database = (await import('better-sqlite3')).default;
      this.db = new Database(dbPath);
      this.db.pragma(`journal_mode = ${sq?.journalMode ?? 'WAL'}`);
      this.db.pragma(`synchronous = ${sq?.synchronous ?? 'NORMAL'}`);
      this.db.pragma(`cache_size = ${sq?.cacheSize ?? -64000}`);
      this.db.pragma(`busy_timeout = ${sq?.busyTimeoutMs ?? 5000}`);
      console.log('✅ Using better-sqlite3 (native performance)');
    } catch {
      console.log('⚠️  better-sqlite3 unavailable, using sql.js (WASM fallback)');
      const { getDatabaseImplementation } = await import('../db-fallback.js');
      const DatabaseImpl = await getDatabaseImplementation();
      this.db = new DatabaseImpl(dbPath);
      // ADR-0069 A1: config-chain SQLite pragmas (WASM — skip journal_mode=WAL, not supported)
      this.db.pragma(`cache_size = ${sq?.cacheSize ?? -64000}`);
      this.db.pragma(`busy_timeout = ${sq?.busyTimeoutMs ?? 5000}`);
      this.usingWasm = true;
    }

    // Resolve embedding config from layered sources (env, file, registry, overrides)
    const embConfig = getEmbeddingConfig({
      model: this.config.embeddingModel,
      dimension: this.config.dimension,
    });
    const dim = embConfig.dimension;

    // Load schemas
    const schemaPath = path.join(__dirname, '../../schemas/schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      this.db.exec(schema);
    }

    const frontierSchemaPath = path.join(__dirname, '../../schemas/frontier-schema.sql');
    if (fs.existsSync(frontierSchemaPath)) {
      const frontierSchema = fs.readFileSync(frontierSchemaPath, 'utf-8');
      this.db.exec(frontierSchema);
    }

    // Initialize embedder using centralized config
    // EmbeddingService accepts 'transformers' | 'openai' | 'local'; map other providers to 'local'
    const esProvider = (embConfig.provider === 'transformers' || embConfig.provider === 'openai')
      ? embConfig.provider
      : 'local' as const;
    this.embedder = new EmbeddingService({
      model: embConfig.model,
      dimension: dim,
      provider: esProvider,
    });
    await this.embedder.initialize();

    // Initialize GraphTransformerService (8 verified modules)
    this.graphTransformer = new GraphTransformerService();
    await this.graphTransformer.initialize();
    console.log(`[AgentDB] GraphTransformer: ${this.graphTransformer.getEngineType()}`);

    // Initialize proof-gated vector backend (ADR-060)
    let controllerVB: VectorBackend | null = null;
    try {
      const { backend, guard, log } = await createGuardedBackend('auto', {
        dimensions: dim,
        metric: 'cosine',
        maxElements: this.config.maxElements ?? getEmbeddingConfig().maxElements, // ADR-0069: config-chain capacity
        ...(this.config.hnswM !== undefined && { M: this.config.hnswM }),
        ...(this.config.hnswEfConstruction !== undefined && { efConstruction: this.config.hnswEfConstruction }),
        ...(this.config.hnswEfSearch !== undefined && { efSearch: this.config.hnswEfSearch }),
        database: this.db,
      });
      this.guardedBackend = backend;
      this.mutationGuard = guard;
      this.attestationLog = log;
      this.vectorBackend = backend;
      controllerVB = backend;
    } catch {
      // Guarded backend unavailable — controllers work without vectorBackend
      controllerVB = null;
    }

    // Initialize shared AttentionService singleton (W1-5)
    if (this.config.enableAttention !== false) {
      this.attentionService = new AttentionService({
        numHeads: 8,
        headDim: Math.floor(dim / 8),
        embedDim: dim,
        useFlash: true,
      });
    }

    // Initialize controllers — wire vectorBackend where supported
    this.reflexion = new ReflexionMemory(this.db, this.embedder, controllerVB ?? undefined);
    this.skills = new SkillLibrary(this.db, this.embedder, controllerVB ?? undefined);
    this.reasoning = new ReasoningBank(this.db, this.embedder, controllerVB ?? undefined);
    this.causalGraph = new CausalMemoryGraph(
      this.db, undefined, undefined, undefined, undefined,
      this.attentionService,
    );
    this.explainableRecall = new ExplainableRecall(
      this.db, this.embedder, undefined,
      this.attentionService,
    );
    this.learningSystem = new LearningSystem(this.db, this.embedder);
    this.causalRecall = new CausalRecall(
      this.db, this.embedder, controllerVB ?? undefined,
      undefined, // config — use default
      this.causalGraph, this.explainableRecall,
    );
    this.nightlyLearner = new NightlyLearner(
      this.db, this.embedder, undefined, // config — use default
      this.causalGraph, this.reflexion, this.skills,
      this.attentionService,
    );

    // Initialize optional graph database adapter (gated by enableGraph config)
    if (this.config.enableGraph) {
      try {
        const { GraphDatabaseAdapter } = await import('../backends/graph/GraphDatabaseAdapter.js');
        const storagePath = this.config.dbPath && this.config.dbPath !== ':memory:'
          ? this.config.dbPath.replace(/\.db$/, '') + '.graph'
          : null;

        if (storagePath) {
          this.graphAdapter = new GraphDatabaseAdapter(
            { storagePath, dimensions: dim },
            this.embedder
          );
          await this.graphAdapter.initialize();
        }
      } catch {
        this.graphAdapter = null;
      }
    }

    this.initialized = true;
  }

  getController(name: string): any {
    if (!this.initialized) {
      throw new Error('AgentDB not initialized. Call initialize() first.');
    }

    switch (name) {
      case 'memory':
      case 'reflexion':
        return this.reflexion;
      case 'skills':
        return this.skills;
      case 'reasoning':
      case 'reasoningBank':
        return this.reasoning;
      case 'causal':
      case 'causalGraph':
        return this.causalGraph;
      case 'causalRecall':
        return this.causalRecall;
      case 'learning':
      case 'learningSystem':
        return this.learningSystem;
      case 'explainableRecall':
        return this.explainableRecall;
      case 'nightlyLearner':
        return this.nightlyLearner;
      case 'graph':
      case 'graphAdapter':
        return this.graphAdapter;
      case 'graphTransformer':
        return this.graphTransformer;
      case 'mutationGuard':
        return this.mutationGuard;
      case 'attestationLog':
        return this.attestationLog;
      case 'vectorBackend':
        return this.vectorBackend;
      case 'queryOptimizer':
        return (this.queryOptimizer ??= new QueryOptimizer(this.db));
      case 'auditLogger':
        return (this.auditLogger ??= new AuditLogger());
      case 'batchOperations':
        return (this.batchOperations ??= new BatchOperations(this.db, this.embedder));
      case 'attentionService':
        return this.attentionService;
      case 'hierarchicalMemory':
        return (this.hierarchicalMemory ??= new HierarchicalMemory(this.db, this.embedder));
      case 'memoryConsolidation':
        return (this.memoryConsolidation ??= new MemoryConsolidation(
          this.db,
          this.getController('hierarchicalMemory'),
          this.embedder,
        ));
      // sparkling/agentic-flow#6: wasmVectorSearch lazy singleton — prevents
      // AgentDBService from constructing a duplicate instance invisible to the
      // ControllerRegistry. Falls back to JS cosine similarity internally if WASM
      // module is unavailable.
      case 'wasmVectorSearch':
        return (this.wasmVectorSearch ??= new WASMVectorSearch(this.db, {
          enableWASM: true,
          enableSIMD: true,
          batchSize: 100,
          indexThreshold: 1000,
        }));
      // sparkling/agentic-flow#6: rvfOptimizer safe-null — RVF optimizer is
      // optional/external. Return null instead of throwing so callers can
      // attempt delegation and fall back gracefully when it is not initialized.
      case 'rvfOptimizer':
        return null;
      // ADR-0069 F1: Phase 2 RuVector controllers (lazy, null if unavailable)
      case 'gnnLearning':
      case 'ruvectorLearning':
        return this.gnnLearning ?? null;
      case 'semanticRouter':
        return this.semanticRouter ?? null;
      case 'sona':
      case 'sonaService':
      case 'sonaTrajectory':
        // sparkling/agentic-flow W5-A3: SonaTrajectoryService lazy singleton.
        // Prior to W5-A3, sonaService was set only via setController() by
        // AgentDBService (ADR-0069 F1 pathway). When called directly through
        // AgentDB.getController('sonaTrajectory') — as W2-I5's
        // `agentdb_sona_trajectory_store` MCP tool does via ruflo's
        // ControllerRegistry — this returned null and the tool surfaced
        // "SonaTrajectoryService controller not available". Now we lazily
        // instantiate the in-memory RL service on first access so the
        // controller is a real, observable singleton regardless of whether
        // an external injection ever happens. Matches the queryOptimizer /
        // auditLogger / batchOperations lazy pattern elsewhere in this switch.
        //
        // Note: SonaTrajectoryService.initialize() is async. getController()
        // is sync by contract, so we trigger initialization as a fire-and-
        // forget Promise. The service supports use before initialize() — it
        // stores trajectories in an in-memory Map keyed by agentType with no
        // external state to boot — and record/predict/getStats all guard
        // internally on initialization state. B5's state-diff check exercises
        // the record + getStats paths which both work pre-initialize.
        if (!this.sonaService) {
          try {
            this.sonaService = new SonaTrajectoryService();
            // Kick off initialization without awaiting — sync contract.
            // Service is designed to be usable pre-initialize: recordTrajectory
            // writes to an in-memory Map keyed by agentType, and getStats
            // reads the same Map. initialize() exists primarily to load the
            // native @ruvector/sona engine; JS-fallback record/predict work
            // regardless. The `initialized` private flag guards @ruvector-
            // specific paths only.
            try {
              const initRes = this.sonaService.initialize?.();
              if (initRes && typeof initRes.then === 'function') {
                initRes.catch(() => { /* non-fatal: record still works uninitialized */ });
              }
            } catch {
              // Non-fatal: service is usable without initialize() for B5 probe path.
            }
          } catch {
            return null;
          }
        }
        return this.sonaService ?? null;
      default:
        throw new Error(`Unknown controller: ${name}`);
    }
  }

  /**
   * ADR-0069 F1: Register an externally-constructed controller.
   * Used by AgentDBService to inject Phase 2 RuVector controllers
   * (gnnLearning, semanticRouter, sonaService) so getController()
   * returns the single canonical instance.
   */
  setController(name: string, instance: any): void {
    switch (name) {
      case 'gnnLearning':
      case 'ruvectorLearning':
        this.gnnLearning = instance;
        break;
      case 'semanticRouter':
        this.semanticRouter = instance;
        break;
      case 'sona':
      case 'sonaService':
      case 'sonaTrajectory':
        this.sonaService = instance;
        break;
      default:
        throw new Error(`Cannot set unknown controller: ${name}`);
    }
  }

  getGraphAdapter(): any {
    return this.graphAdapter;
  }

  getGraphTransformer(): GraphTransformerService {
    return this.graphTransformer;
  }

  getMutationGuard(): MutationGuard | null {
    return this.mutationGuard;
  }

  getEmbeddingService(): EmbeddingService | null {
    return this.embedder ?? null;
  }

  async close(): Promise<void> {
    if (this.vectorBackend) {
      try { this.vectorBackend.close(); } catch { /* ignore */ }
    }
    if (this.db) {
      this.db.close();
    }
  }

  get database(): any {
    return this.db;
  }

  // Check if using WASM backend
  get isWasm(): boolean {
    return this.usingWasm;
  }

  // Get vector backend info
  get vectorBackendName(): string {
    return this.vectorBackend?.name || 'none';
  }
}
