/**
 * AgentDB - Main database wrapper class
 *
 * Provides a unified interface to all AgentDB controllers with:
 * - better-sqlite3 (native) for relational storage; the sql.js WASM engine is
 *   used ONLY when explicitly opted into (AGENTDB_ALLOW_SQLJS_FALLBACK or
 *   forceWasm) — a native load failure FAILS LOUD, never silently degrades
 *   (ADR-0082 no-silent-fallback; the silent swap is what hid ADR-0285 P3/P4/P6)
 * - RuVector for optimized vector search (150x faster than SQLite)
 * - Unified integration passing vector backend to all controllers
 */
import { ReflexionMemory } from '../controllers/ReflexionMemory.js';
import { ReasoningBank } from '../controllers/ReasoningBank.js';
import { SkillLibrary } from '../controllers/SkillLibrary.js';
import { CausalMemoryGraph } from '../controllers/CausalMemoryGraph.js';
import { CausalRecall } from '../controllers/CausalRecall.js';
import { ExplainableRecall } from '../controllers/ExplainableRecall.js';
import { NightlyLearner } from '../controllers/NightlyLearner.js';
import { HierarchicalMemory } from '../controllers/HierarchicalMemory.js';
import { LearningSystem } from '../controllers/LearningSystem.js';
import { MemoryConsolidation } from '../controllers/MemoryConsolidation.js';
import { QueryOptimizer } from '../optimizations/QueryOptimizer.js';
import { BatchOperations } from '../optimizations/BatchOperations.js';
import { MutationGuard } from '../security/MutationGuard.js';
import { AuditLogger } from '../services/audit-logger.service.js';
import { EmbeddingService } from '../controllers/EmbeddingService.js';
import { createBackend } from '../backends/factory.js';
import type { VectorBackend } from '../backends/VectorBackend.js';
import type { IDatabaseConnection } from '../types/database.types.js';
import { getConfig, validateBoot } from './config-chain.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AgentDBConfig {
  dbPath?: string;
  namespace?: string;
  enableAttention?: boolean;
  attentionConfig?: Record<string, any>;
  /** Force use of sql.js WASM even if better-sqlite3 is available */
  forceWasm?: boolean;
  /** Vector backend type: 'auto' | 'ruvector' | 'hnswlib' */
  vectorBackend?: 'auto' | 'ruvector' | 'hnswlib';
  /** Vector dimension (default: 384 for MiniLM) */
  vectorDimension?: number;
  /** SQLite-specific tuning (ADR-0069 A1: config-driven pragmas) */
  sqlite?: {
    cacheSize?: number;
    busyTimeoutMs?: number;
    journalMode?: string;
    synchronous?: string;
  };
  /** @deprecated ADR-0170 Phase D: graph-node retired; passing true throws at initialize() */
  enableGraph?: boolean;
}

/**
 * Decide how to handle a native `better-sqlite3` load/open failure
 * (ADR-0082 no-silent-fallback / fail-loud-fast).
 *
 * Returns the actionable `Error` to throw by DEFAULT — AgentDB must NOT silently
 * degrade to the sql.js WASM engine, which is slower and has historically
 * diverged from better-sqlite3 on parameter binding + SAVEPOINT handling (the
 * ADR-0285 P3/P4/P6 bug class). A silent swap hides BOTH the real failure
 * (missing prebuild / ABI skew / no build tools) AND those divergences behind a
 * backend that no better-sqlite3 test can catch — the exact trap the rule exists
 * to prevent.
 *
 * Returns `null` ONLY when the WASM engine was EXPLICITLY opted into via
 * `AGENTDB_ALLOW_SQLJS_FALLBACK` (`1` | `true` | `yes`); the caller then proceeds
 * to the WASM engine. `forceWasm: true` skips the native attempt up front and is
 * the cleaner choice for known build-tool-less environments.
 *
 * Exported for direct unit testing of the loud-vs-opt-in branch without standing
 * up the full `AgentDB.initialize()` pipeline.
 */
export function resolveBetterSqlite3LoadFailure(
  error: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Error | null {
  const optIn = env.AGENTDB_ALLOW_SQLJS_FALLBACK;
  if (optIn === '1' || optIn === 'true' || optIn === 'yes') {
    return null; // explicit opt-in → caller falls back to the WASM engine
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(
    `[AgentDB] native better-sqlite3 failed to load: ${reason}\n` +
      `Refusing to silently fall back to the sql.js WASM engine — it is slower and ` +
      `has historically diverged from better-sqlite3 on parameter binding + SAVEPOINTs ` +
      `(the ADR-0285 P3/P4/P6 bug class), so a silent swap would hide both this failure ` +
      `and those divergences.\n` +
      `Fix the native module:\n` +
      `  - after a Node upgrade / ABI change:  npm rebuild better-sqlite3\n` +
      `  - missing build tools:  install Xcode CLT (macOS) or build-essential (Linux), then reinstall\n` +
      `  - or run Node on the ABI the prebuilt binary targets\n` +
      `If you genuinely need the WASM engine (no build tools), opt in EXPLICITLY: set ` +
      `AGENTDB_ALLOW_SQLJS_FALLBACK=1, or construct AgentDB with { forceWasm: true }.`,
  );
}

export class AgentDB {
  private db!: IDatabaseConnection;
  private reflexion!: ReflexionMemory;
  private reasoningBank!: ReasoningBank;
  private skills!: SkillLibrary;
  private causalGraph!: CausalMemoryGraph;
  private causalRecall: CausalRecall | undefined;
  private explainableRecall: ExplainableRecall | undefined;
  private nightlyLearner: NightlyLearner | undefined;
  private hierarchicalMemory: HierarchicalMemory | undefined;
  private learningSystem: LearningSystem | undefined;
  private memoryConsolidation: MemoryConsolidation | undefined;
  private queryOptimizer: QueryOptimizer | undefined;
  private batchOperations: BatchOperations | undefined;
  private mutationGuard: MutationGuard | undefined;
  private auditLogger: AuditLogger | undefined;
  private embedder!: EmbeddingService;
  public vectorBackend!: VectorBackend;
  private initialized = false;
  private config: AgentDBConfig;
  private usingWasm = false;

  constructor(config: AgentDBConfig = {}) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // ADR-0177 Phase 1.6 (e): boot validation reads the substrate-wide config
    // chain (.claude-flow/embeddings.json) and throws ConfigChainValidationError
    // if embedding.model is missing or if a paid provider is configured without
    // allowPaidProvider=true (feedback-no-api-keys). Per Amendment 2 (2026-05-12)
    // does NOT validate @xenova availability.
    // ADR-0170 Phase D: graph-node retired; loud-reject instead of silently no-op
    if (this.config.enableGraph) {
      throw new Error(
        'AgentDB: enableGraph is no longer supported (ADR-0170 Phase D). ' +
        'The graph-node backend was retired. Remove enableGraph from your config.',
      );
    }

    validateBoot();
    const chain = getConfig();

    const dbPath = this.config.dbPath || ':memory:';
    // Substrate-wide dim from config chain wins over hardcoded 384; explicit
    // AgentDBConfig.vectorDimension still overrides (ADR-0175 dim-lock semantics).
    const vectorDimension = this.config.vectorDimension || chain.embedding.dimension;

    // Initialize database with unified fallback system
    this.db = await this.initializeDatabase(dbPath);

    // Load schemas
    await this.loadSchemas();

    // Initialize embedder using config-chain defaults (model + provider).
    // EmbeddingService constructor falls back to the chain when args omitted.
    this.embedder = new EmbeddingService({
      dimension: vectorDimension,
    });
    await this.embedder.initialize();

    // Initialize vector backend (RuVector preferred, HNSWLib fallback)
    this.vectorBackend = await createBackend(this.config.vectorBackend || 'auto', {
      dimensions: vectorDimension,
      metric: 'cosine'
    });

    // Initialize controllers WITH vector backend for optimized search
    // This enables 150x faster vector search via RuVector instead of SQLite brute-force
    this.reflexion = new ReflexionMemory(this.db, this.embedder, this.vectorBackend);
    this.reasoningBank = new ReasoningBank(this.db, this.embedder, this.vectorBackend);
    this.skills = new SkillLibrary(this.db, this.embedder, this.vectorBackend);
    this.causalGraph = new CausalMemoryGraph(
      this.db,
      undefined, // graphBackend - not used in default initialization
      this.embedder,
      undefined, // config - use defaults
      this.vectorBackend
    );

    this.causalRecall = new CausalRecall(this.db as any, this.embedder, this.vectorBackend);
    this.explainableRecall = new ExplainableRecall(this.db as any, this.embedder);
    this.nightlyLearner = new NightlyLearner(this.db as any, this.embedder);
    this.hierarchicalMemory = new HierarchicalMemory(this.db as any, this.embedder, this.vectorBackend);
    // ADR-0181 Item 5 (2026-05-16): LearningSystem now consumes the shared
    // better-sqlite3 handle directly (post-pglite). The four `learning_*`
    // tables were provisioned by `loadSchemas()` above. Singleton-cache
    // (ADR-0076 A4) means a duplicate construction returns the existing
    // instance rather than re-running the GNN/Sona enhancement init.
    this.learningSystem = new LearningSystem(this.db as any, this.embedder);
    this.memoryConsolidation = new MemoryConsolidation(
      this.db as any, this.hierarchicalMemory, this.embedder, this.vectorBackend,
    );
    this.queryOptimizer = new QueryOptimizer(this.db as any);
    this.batchOperations = new BatchOperations(this.db as any, this.embedder);
    this.auditLogger = new AuditLogger();

    this.initialized = true;

    console.log(`[AgentDB] Initialized with ${this.usingWasm ? 'sql.js WASM' : 'better-sqlite3'} + ${this.vectorBackend.name} vector backend`);
  }

  /**
   * Initialize database with automatic fallback:
   * 1. Try better-sqlite3 (native, fastest)
   * 2. Fallback to sql.js WASM (no build tools required)
   */
  private async initializeDatabase(dbPath: string): Promise<IDatabaseConnection> {
    // Force WASM if requested
    if (this.config.forceWasm) {
      return this.initializeSqlJsWasm(dbPath);
    }

    // ADR-0069 A1: SQLite performance pragmas are config-driven with safe
    // fallbacks (consistent with @claude-flow/memory's sqlite-backend and the
    // agentic-flow WAL sites). Declared outside the try so the value is in
    // scope for the catch/WASM path. `busy_timeout` in particular prevents
    // SQLITE_BUSY under the concurrent controller access agentdb sees (the
    // controllers share one better-sqlite3 handle).
    const sq = this.config.sqlite;

    // Try better-sqlite3 first (native performance)
    try {
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(dbPath);
      db.pragma(`journal_mode = ${sq?.journalMode ?? 'WAL'}`);
      db.pragma(`synchronous = ${sq?.synchronous ?? 'NORMAL'}`);
      db.pragma(`cache_size = ${sq?.cacheSize ?? -64000}`);
      db.pragma(`busy_timeout = ${sq?.busyTimeoutMs ?? 5000}`);
      this.usingWasm = false;
      return db as unknown as IDatabaseConnection;
    } catch (error) {
      // No silent fallback (ADR-0082 / fail-loud-fast). A native better-sqlite3
      // failure is NOT silently downgraded to the sql.js WASM engine — that path
      // is slower AND historically diverged on parameter binding + SAVEPOINTs
      // (ADR-0285 P3/P4/P6), so a silent swap hides both this failure (ABI skew on
      // a stale install, missing prebuild, Node-version skew, no build tools) and
      // those divergences behind a backend no better-sqlite3 test can catch — the
      // precise trap that masked the pre-ADR-0285 bind bug as "Internal error" on a
      // long-running daemon. Fail loud unless WASM was EXPLICITLY opted into.
      const loudError = resolveBetterSqlite3LoadFailure(error);
      if (loudError) throw loudError;
      // AGENTDB_ALLOW_SQLJS_FALLBACK is set — proceed to the WASM engine, but warn.
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[AgentDB] native better-sqlite3 failed to load (${reason}); ` +
          `AGENTDB_ALLOW_SQLJS_FALLBACK is set — using the sql.js WASM engine. This ` +
          `path is slower and historically diverges on binding/SAVEPOINTs (ADR-0285 ` +
          `P3/P4/P6); prefer fixing the native build.`,
      );
      return this.initializeSqlJsWasm(dbPath);
    }
  }

  /**
   * Initialize sql.js WASM database
   */
  private async initializeSqlJsWasm(dbPath: string): Promise<IDatabaseConnection> {
    const { createDatabase } = await import('../db-fallback.js');
    const db = await createDatabase(dbPath);
    this.usingWasm = true;
    return db as IDatabaseConnection;
  }

  /**
   * Load database schemas
   */
  private async loadSchemas(): Promise<void> {
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

    // ADR-0261 (2026-05-27): fork-native ADR-130 re-implementation. The
    // `graph_edges` table holds reinforcement-decay edges between memory rows.
    // FK to memory_entries deferred — see implementation note in
    // graph-edges.sql for the schema-impedance rationale.
    const graphEdgesSchemaPath = path.join(__dirname, '../../schemas/graph-edges.sql');
    if (fs.existsSync(graphEdgesSchemaPath)) {
      const graphEdgesSchema = fs.readFileSync(graphEdgesSchemaPath, 'utf-8');
      this.db.exec(graphEdgesSchema);
    }

    // ADR-0268: additive `episodes` columns for autonomous skill promotion.
    // `CREATE TABLE IF NOT EXISTS` above won't add columns to an episodes table
    // created by an earlier release, so add them idempotently here.
    this.ensureEpisodeColumns();
  }

  /**
   * ADR-0268/0279: idempotently add the `task_type` / `code` / `action` columns
   * to a pre-existing `episodes` table (fresh dbs already get them from
   * schema.sql). Only the benign "duplicate column" (fresh db) / "no such table"
   * (partial schema) cases are swallowed; anything else surfaces per ADR-0082
   * fail-loud.
   */
  private ensureEpisodeColumns(): void {
    for (const col of ['task_type', 'code', 'action']) {
      try {
        this.db.exec(`ALTER TABLE episodes ADD COLUMN ${col} TEXT`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/duplicate column name|no such table/i.test(msg)) throw err;
      }
    }
  }

  /** Exposes the underlying database connection for controller wiring in memory package. */
  get database(): IDatabaseConnection {
    return this.db;
  }

  getController(name: string): any {
    if (!this.initialized) {
      throw new Error('AgentDB not initialized. Call initialize() first.');
    }

    switch (name) {
      case 'memory':
      case 'reflexion':
        return this.reflexion;
      case 'reasoning':
      case 'reasoningBank':
        return this.reasoningBank;
      case 'skills':
        return this.skills;
      case 'causal':
      case 'graph':
      case 'causalGraph':
        return this.causalGraph;
      case 'causalRecall':
        return this.causalRecall;
      case 'learning':
      case 'learningSystem':
        // ADR-0181 Item 5: post-pglite LearningSystem returns the live
        // controller. The pre-Item-5 comment (`requires PostgresBackend; use
        // MCP tool agentdb_learner_run instead`) was the workaround for the
        // ADR-0170 era — superseded by the SQLite port.
        return this.learningSystem;
      case 'explainableRecall':
        return this.explainableRecall;
      case 'nightlyLearner':
        return this.nightlyLearner;
      case 'queryOptimizer':
        return this.queryOptimizer;
      case 'auditLogger':
        return this.auditLogger;
      case 'batchOperations':
        return this.batchOperations;
      case 'attentionService':
        return this.config.enableAttention ? undefined : undefined; // requires explicit AttentionConfig
      case 'hierarchicalMemory':
        return this.hierarchicalMemory;
      case 'memoryConsolidation':
        return this.memoryConsolidation;
      case 'vectorBackend':
        return this.vectorBackend;
      case 'mutationGuard':
        return this.mutationGuard;
      default:
        throw new Error(`Unknown controller: ${name}`);
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
    }
  }

  // Check if using WASM backend
  get isWasm(): boolean {
    return this.usingWasm;
  }

  // Get vector backend info
  get vectorBackendName(): string {
    return this.vectorBackend?.name || 'none';
  }

  // ADR-0063 C2: expose the internal EmbeddingService for consumers that need
  // direct embedding generation (e.g. acceptance test introspection).
  getEmbeddingService(): EmbeddingService {
    if (!this.initialized) {
      throw new Error('AgentDB not initialized. Call initialize() first.');
    }
    return this.embedder;
  }
}
