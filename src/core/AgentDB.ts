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
import { PostgresBackend } from '../backends/postgres/PostgresBackend.js';
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

// ADR-0166 Phase 2: fire the `vectorBackend` deprecation warning at most
// once per process to avoid spamming the CLI/acceptance harness output —
// many ruflo call sites construct a fresh AgentDB per invocation and each
// would otherwise emit the same line.
let _adr0166DeprecationWarned = false;

export interface AgentDBConfig {
  dbPath?: string;
  namespace?: string;
  dimension?: number;
  maxElements?: number;
  enableAttention?: boolean;
  attentionConfig?: Record<string, any>;
  /** Force use of sql.js WASM even if better-sqlite3 is available */
  forceWasm?: boolean;
  /**
   * Vector backend type.
   *
   * @deprecated ADR-0166 Phase 2: use `vectorIndex` for the search-index axis
   * and `primaryStorage` for the persistence axis. `vectorBackend` is mirrored
   * to `vectorIndex` when only the legacy field is set; a deprecation warning
   * is emitted on initialize().
   */
  vectorBackend?: 'auto' | 'ruvector' | 'hnswlib';
  /**
   * Vector-search index engine (ADR-0170 §Phase A item 4 widens the union).
   *
   * Under ADR-0170 the valid values are:
   *   - `'auto'` — runtime factory detection (cascades through available
   *     backends; Phase C will prefer pgvector when it lands)
   *   - `'pgvector'` — postgres-native HNSW/IVFFlat index (Phase C)
   *   - `'postgres-cli'` — higher-level @ruvector/postgres-cli surface
   *
   * The legacy values `'ruvector'` and `'hnswlib'` are retired per
   * ADR-0170 §"Implementation pre-flight item 1" — passing either throws
   * a loud error at boot pointing users to `'pgvector'` or `'auto'`.
   *
   * Phase A keeps the broader union for forward declaration; the
   * loud-rejection of 'ruvector'/'hnswlib' is implemented in
   * initialize() below (config-validation throw).
   *
   * `'sqlite-vec'` remains in the declared union for Phase A diff
   * cleanliness (the existing tryLoadSqliteVec() path checks for it),
   * but Phase D removes it alongside Option F dead-strip.
   */
  vectorIndex?: 'auto' | 'ruvector' | 'hnswlib' | 'sqlite-vec' | 'pgvector' | 'postgres-cli';
  /**
   * Primary persistence substrate (ADR-0170 §Phase A item 4).
   *
   * Under ADR-0170 the valid values are:
   *   - `'pglite'` (default) — embedded WASM postgres 15 via
   *     @electric-sql/pglite. Persists to <dataDir>/.
   *   - `'postgres'` — real postgres server via node-postgres. Opt-in via
   *     this field set to 'postgres' or via the AGENTDB_POSTGRES_URL env.
   *
   * The legacy value `'sqlite'` is REMOVED. There is no 'auto'-cascade for
   * the relational substrate axis — passing 'auto' or anything other than
   * 'pglite'/'postgres' throws a loud error at boot per
   * memory feedback-no-fallbacks. See ADR-0170 §"No-fallback policy".
   */
  primaryStorage?: 'pglite' | 'postgres';
  /**
   * Optional PostgreSQL connection string (ADR-0170 §Phase A item 4).
   *
   * When set, AgentDB runs in server mode against the supplied URL. When
   * unset and primaryStorage='postgres', the AGENTDB_POSTGRES_URL env var
   * is consulted next. When both are unset and primaryStorage='pglite'
   * (or unset), AgentDB runs in embedded pglite mode against
   * `<dataDir>/.swarm/memory.pglite/` (see PostgresBackend.resolveDataDir).
   */
  connectionString?: string;
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
  // ADR-0170 Phase B: shared PostgresBackend for postgres-dialect
  // controllers. Lazy-constructed at first request from getController().
  // pglite-embedded by default (config.connectionString opts into server
  // mode). PostgresBackend.initialize() is idempotent; each controller
  // awaits it before issuing SQL so the cluster warm-up cost is paid once
  // per AgentDB instance.
  private postgresBackend?: PostgresBackend;
  // sparkling/agentic-flow#6: lazy singleton for WASM vector search
  private wasmVectorSearch: any = null;
  // ADR-0069 F1: Phase 2 RuVector controllers (set externally or null)
  private gnnLearning: any = null;
  private semanticRouter: any = null;
  private sonaService: any = null;
  private initialized = false;
  private config: AgentDBConfig;
  private usingWasm = false;
  // ADR-0166 Phase 3 (Option F): tracks whether the sqlite-vec extension
  // is loaded on `this.db`. Controllers consult this flag to decide whether
  // to route vector ops through the `<controller>_vec` virtual tables
  // (Option F augmentation) or fall back to the pre-Option-F path
  // (createGuardedBackend → RuVector/HNSWLib/sql.js-RVF).
  private _sqliteVecLoaded = false;

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

    // ADR-0166 Phase 2 (Option E): resolve the vector-index axis from the
    // orthogonal `vectorIndex` field, falling back to the deprecated
    // `vectorBackend` alias for backward compat with ~9 ruflo call sites.
    const legacyVB = this.config.vectorBackend;
    const explicitVI = this.config.vectorIndex;
    if (legacyVB !== undefined && explicitVI === undefined && !_adr0166DeprecationWarned) {
      // Emit deprecation warning to stderr — once per process. Non-fatal;
      // the alias still works. Subsequent AgentDB instances within the same
      // process honor the field silently.
      _adr0166DeprecationWarned = true;
      console.warn(
        `[AgentDB] AgentDBConfig.vectorBackend='${legacyVB}' is deprecated (ADR-0166 Phase 2). ` +
        `Use vectorIndex='${legacyVB}' instead. The alias will be removed in a future major.`,
      );
    }
    // ADR-0170 Phase A.4: the union widens to include 'pgvector' and
    // 'postgres-cli' (Phase C-bound). 'ruvector' and 'hnswlib' are
    // loud-rejected below — they never reach resolvedVI. The Phase A
    // factory call still cascades through ruvector/rvf/hnswlib for the
    // vector-index axis until Phase C wires pgvector as the preferred
    // winner.
    const resolvedVI: 'auto' | 'ruvector' | 'hnswlib' | 'sqlite-vec' | 'pgvector' | 'postgres-cli' =
      explicitVI ?? legacyVB ?? 'auto';

    // ADR-0170 Phase A.4 config validation (replaces the ADR-0166 'sqlite'-
    // only check). Valid values are 'pglite' | 'postgres'; 'sqlite' is
    // retired. Per memory feedback-no-fallbacks, reject any other value
    // (including 'auto' and the legacy 'sqlite') loudly at boot.
    //
    // NOTE: the SQLite open path below remains active in Phase A — the
    // strict "pglite or postgres or throw" boot gate activates with
    // Phase B's first controller commit per ADR-0170 §Phase A item 1.
    // Phase A is plumbing; the substrate is not yet swapped under the
    // running controllers.
    const ps = (this.config as any).primaryStorage;
    if (ps !== undefined && ps !== 'pglite' && ps !== 'postgres') {
      throw new Error(
        `[AgentDB] AgentDBConfig.primaryStorage='${ps}' is not supported. ` +
        `ADR-0170 retires SQLite for the agentdb_* axis; only 'pglite' (embedded) ` +
        `and 'postgres' (server) are valid. See docs/adr/ADR-0170-agentdb-substrate-replacement-postgresql.md ` +
        `§"No-fallback policy". The relational substrate axis has no 'auto' value.`
      );
    }

    // ADR-0170 Phase A.4 config validation: vectorIndex 'ruvector' and
    // 'hnswlib' are retired (vectors become first-class column types under
    // pgvector in Phase C). Reject them loudly per feedback-no-fallbacks.
    const viRaw = (this.config as any).vectorIndex;
    if (viRaw === 'ruvector' || viRaw === 'hnswlib') {
      throw new Error(
        `[AgentDB] AgentDBConfig.vectorIndex='${viRaw}' is not supported. ` +
        `ADR-0170 §"Implementation pre-flight item 1" retires the in-memory ` +
        `vector-index axis selection — vectors become first-class column types ` +
        `under pgvector in Phase C. Use vectorIndex='pgvector' or vectorIndex='auto' ` +
        `instead.`
      );
    }

    // ADR-0166 Phase 3 (Option F): try to load the sqlite-vec extension.
    // - WASM substrate: extension loading unsupported; loud-error iff user
    //   explicitly opted in (vectorIndex='sqlite-vec') per feedback-no-fallbacks.
    // - Native substrate: try sqliteVec.load(); on failure, loud-error iff opted in,
    //   else proceed in degraded mode (pre-Option-F path remains valid).
    this._sqliteVecLoaded = await this.tryLoadSqliteVec(resolvedVI);
    if (this._sqliteVecLoaded) {
      this.createOptionFVirtualTables(dim);
    }

    // Initialize proof-gated vector backend (ADR-060)
    // ADR-0166 Phase 1: honor the resolved vectorIndex (was hard-coded 'auto').
    // ADR-0166 Phase 3: when vectorIndex='sqlite-vec', the search axis runs via
    // virtual tables (no in-memory backend needed); pass 'auto' to the factory
    // so the in-memory backend still gets initialized (controllers fall back to
    // it for ops not yet migrated to Option F).
    //
    // ADR-0170 Phase A.4: 'pgvector' / 'postgres-cli' also route 'auto' to the
    // factory in Phase A — pgvector tables don't exist yet (Phase C). The
    // factory's vector-index auto-cascade picks the available in-memory
    // backend until Phase C lights up pgvector.
    const factoryType: 'auto' | 'ruvector' | 'hnswlib' =
      resolvedVI === 'sqlite-vec' || resolvedVI === 'pgvector' || resolvedVI === 'postgres-cli'
        ? 'auto'
        : resolvedVI;
    let controllerVB: VectorBackend | null = null;
    try {
      const { backend, guard, log } = await createGuardedBackend(factoryType, {
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

  /**
   * Lazily construct the shared PostgresBackend instance used by
   * postgres-dialect controllers (ADR-0170 Phase B). Embedded pglite by
   * default; opt into server mode via `config.connectionString` or the
   * `AGENTDB_POSTGRES_URL` env var.
   *
   * The backend's own `initialize()` is async; each consumer controller
   * awaits it before its first SQL call, so this helper returns the
   * (uninitialized) handle synchronously to fit the sync getController()
   * contract. The construction itself is cheap — pglite/pg dynamic imports
   * happen inside `initialize()`, not the constructor.
   */
  private getPostgresBackend(): PostgresBackend {
    if (!this.postgresBackend) {
      this.postgresBackend = new PostgresBackend({
        metric: 'cosine',
        connectionString: this.config.connectionString,
      });
    }
    return this.postgresBackend;
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
        // ADR-0170 Phase B.1: HierarchicalMemory runs on PostgresBackend
        // (pglite-embedded by default, postgres-server when AGENTDB_POSTGRES_URL
        // or config.connectionString is set). Sibling controllers retain
        // their SQLite `this.db` handle until their own Phase B commit lands.
        return (this.hierarchicalMemory ??= new HierarchicalMemory(
          this.getPostgresBackend(),
          this.embedder,
        ));
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

  /**
   * ADR-0166 Phase 3 (Option F): true when the sqlite-vec extension is loaded
   * on `this.db` and per-controller virtual tables (`<controller>_vec`) are
   * available for k-NN routing. Controllers consult this getter to pick between
   * Option F (virtual-table path) and the pre-Option-F path.
   */
  get sqliteVecLoaded(): boolean {
    return this._sqliteVecLoaded;
  }

  /**
   * ADR-0166 Phase 3 (Option F): load the sqlite-vec extension on `this.db`
   * when running on better-sqlite3. Returns true when loaded, false when
   * gracefully degraded (extension absent and user did NOT opt in).
   *
   * Loud-error per `feedback-no-fallbacks` when:
   *  - vectorIndex='sqlite-vec' on WASM substrate (no extension loader exists)
   *  - vectorIndex='sqlite-vec' on native substrate and load() throws
   */
  private async tryLoadSqliteVec(
    resolvedVI: 'auto' | 'ruvector' | 'hnswlib' | 'sqlite-vec' | 'pgvector' | 'postgres-cli',
  ): Promise<boolean> {
    if (this.usingWasm) {
      if (resolvedVI === 'sqlite-vec') {
        throw new Error(
          `[AgentDB] vectorIndex='sqlite-vec' requires native better-sqlite3 ` +
          `extension loading; the sql.js WASM substrate cannot host sqlite-vec ` +
          `virtual tables. Either install better-sqlite3 or pick a different ` +
          `vectorIndex for WASM environments.`,
        );
      }
      return false;
    }
    try {
      // sqlite-vec ships no TypeScript declarations; opaque-import via `any`.
      // @ts-ignore - sqlite-vec is an optionalDependency, present at runtime
      const sqliteVec: any = await import('sqlite-vec');
      // sqlite-vec exposes `load(db)` which calls db.loadExtension under the hood.
      const loadFn = sqliteVec.load ?? sqliteVec.default?.load;
      if (typeof loadFn !== 'function') {
        throw new Error('sqlite-vec module loaded but `load(db)` function not found');
      }
      loadFn(this.db);
      console.log('[AgentDB] sqlite-vec extension loaded (ADR-0166 Option F augmentation enabled)');
      return true;
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      if (resolvedVI === 'sqlite-vec') {
        throw new Error(
          `[AgentDB] vectorIndex='sqlite-vec' requested but extension failed to load: ` +
          `${message}. Install with: npm install sqlite-vec`,
        );
      }
      // Degraded mode: pre-Option-F path remains valid. No silent fallback —
      // controllers explicitly check `sqliteVecLoaded` before routing through
      // virtual tables.
      return false;
    }
  }

  /**
   * ADR-0166 Phase 3 (Option F): create the per-controller vec0 virtual tables.
   * Called from initialize() after the schemas are loaded and sqlite-vec is
   * available. Idempotent (IF NOT EXISTS).
   *
   * The 9 augmented controllers per ADR-0166 §"Phase 3 — controllers to augment":
   *   TRIVIAL:  hmem_vec, consolidated_vec, (SyncCoordinator has no vector ops)
   *   MODERATE: reflexion_episode_vec, skill_vec, reasoning_pattern_vec,
   *             recall_vec, learning_vec, quic_vec (when QUICServer has ops)
   *
   * The 5 PERMANENT_SQLITE_CARVE_OUT controllers are intentionally absent:
   *   CausalMemoryGraph, CausalRecall, NightlyLearner, LearningSystem
   *   aggregations, ReasoningBank GROUP BY queries.
   */
  private createOptionFVirtualTables(dim: number): void {
    if (!this._sqliteVecLoaded) return;
    // sqlite-vec `+col TEXT` declares an auxiliary metadata column on the
    // vec0 virtual table. We use TEXT uniformly for the join id even when
    // the base table is INTEGER AUTOINCREMENT — sqlite-vec auxiliary INTEGER
    // columns reject JS number bindings under better-sqlite3 with
    // "auxiliary column id has type INTEGER, but FLOAT was provided"
    // (regardless of Number.isInteger). TEXT bindings work universally and
    // sqlite still indexes them efficiently for equality lookups. Controllers
    // stringify their numeric ids when mirroring writes.
    const ddl = [
      // TRIVIAL bucket
      `CREATE VIRTUAL TABLE IF NOT EXISTS hmem_vec USING vec0(+id TEXT, embedding float[${dim}]);`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS consolidated_vec USING vec0(+id TEXT, embedding float[${dim}]);`,
      // MODERATE bucket
      `CREATE VIRTUAL TABLE IF NOT EXISTS reflexion_episode_vec USING vec0(+id TEXT, embedding float[${dim}]);`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS skill_vec USING vec0(+id TEXT, embedding float[${dim}]);`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS reasoning_pattern_vec USING vec0(+id TEXT, embedding float[${dim}]);`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS recall_vec USING vec0(+id TEXT, embedding float[${dim}]);`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS learning_vec USING vec0(+id TEXT, embedding float[${dim}]);`,
    ].join('\n');
    try {
      this.db.exec(ddl);
    } catch (err) {
      // sqlite-vec is loaded but vec0 module syntax was rejected. Loud-fail —
      // this signals a sqlite-vec ABI break or version mismatch, not a graceful
      // missing-feature situation.
      throw new Error(
        `[AgentDB] sqlite-vec extension loaded but vec0 virtual-table DDL failed: ` +
        `${(err as Error).message}. Check sqlite-vec version compatibility.`,
      );
    }
  }
}
