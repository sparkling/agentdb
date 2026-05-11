/**
 * CLI and MCP Integration Tests
 *
 * Validates:
 * - CLI commands work correctly
 * - MCP tools integration
 * - Backward compatibility with SQLite
 * - Migration from SQLite to GraphDatabase
 * - All exports are available
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = path.join(process.cwd(), 'test-cli-data');
const SQLITE_DB = path.join(TEST_DIR, 'legacy.db');
const GRAPH_DB = path.join(TEST_DIR, 'modern.graph');

beforeAll(() => {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
});

afterAll(() => {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('CLI Commands', () => {
  it('should show help', () => {
    const output = execSync('npx tsx src/cli/agentdb-cli.ts --help', { encoding: 'utf-8' });

    expect(output).toContain('AgentDB v2 CLI');
    expect(output).toContain('CORE COMMANDS');
    expect(output).toContain('init');
    expect(output).toContain('migrate');
    console.log('✅ CLI help command working');
  });

  it('should initialize database', () => {
    const output = execSync(`npx tsx src/cli/agentdb-cli.ts init ${SQLITE_DB} --dimension 384`, {
      encoding: 'utf-8',
      cwd: process.cwd()
    });

    expect(fs.existsSync(SQLITE_DB)).toBe(true);
    console.log('✅ CLI init command working - database created');
  });

  it('should show status', () => {
    const output = execSync(`npx tsx src/cli/agentdb-cli.ts status --db ${SQLITE_DB}`, {
      encoding: 'utf-8',
      cwd: process.cwd()
    });

    expect(output).toContain('AgentDB Status');
    console.log('✅ CLI status command working');
  });

  it('should export database stats', () => {
    const output = execSync(`npx tsx src/cli/agentdb-cli.ts db stats`, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      env: { ...process.env, AGENTDB_PATH: SQLITE_DB }
    });

    expect(output).toBeTruthy();
    console.log('✅ CLI stats command working');
  });
});

describe('SDK Exports', () => {
  it('should export all controllers', async () => {
    const agentdb = await import('../src/index.js');

    expect(agentdb.ReflexionMemory).toBeDefined();
    expect(agentdb.SkillLibrary).toBeDefined();
    expect(agentdb.CausalMemoryGraph).toBeDefined();
    expect(agentdb.CausalRecall).toBeDefined();
    expect(agentdb.ExplainableRecall).toBeDefined();
    expect(agentdb.NightlyLearner).toBeDefined();
    expect(agentdb.EmbeddingService).toBeDefined();

    console.log('✅ All controllers exported');
  });

  it('should export database utilities', async () => {
    const agentdb = await import('../src/index.js');

    expect(agentdb.createDatabase).toBeDefined();
    // getDatabaseImplementation is internal, not exported

    console.log('✅ Database utilities exported');
  });

  it('should export GraphDatabase adapter', async () => {
    const { GraphDatabaseAdapter } = await import('../src/backends/graph/GraphDatabaseAdapter.js');

    expect(GraphDatabaseAdapter).toBeDefined();
    expect(typeof GraphDatabaseAdapter).toBe('function');

    console.log('✅ GraphDatabaseAdapter exported');
  });

  // ADR-0170 Phase A.6: db-unified.ts is retired. The graph-mode-vs-sqlite-
  // legacy split it implemented collapses under PostgreSQL's single substrate.
  // PostgresBackend is the new canonical relational substrate.
  it('should export PostgresBackend', async () => {
    const { PostgresBackend } = await import('../src/backends/postgres/PostgresBackend.js');

    expect(PostgresBackend).toBeDefined();
    expect(typeof PostgresBackend).toBe('function');

    console.log('✅ PostgresBackend exported (ADR-0170 substrate replacement)');
  });
});

describe('Backward Compatibility - SQLite', () => {
  it('should create SQLite database with legacy mode', async () => {
    const { createDatabase } = await import('../src/db-fallback.js');

    const db = await createDatabase(SQLITE_DB);
    expect(db).toBeDefined();
    expect(typeof db.prepare).toBe('function');
    expect(typeof db.exec).toBe('function');

    console.log('✅ SQLite createDatabase working (backward compatible)');

    db.close();
  });

  it('should work with ReflexionMemory on SQLite', async () => {
    const { createDatabase } = await import('../src/db-fallback.js');
    const { ReflexionMemory } = await import('../src/controllers/ReflexionMemory.js');
    const { EmbeddingService } = await import('../src/controllers/EmbeddingService.js');

    const db = await createDatabase(SQLITE_DB);
    const embedder = new EmbeddingService({
      model: 'Xenova/all-MiniLM-L6-v2',
      dimension: 384,
      provider: 'transformers'
    });
    await embedder.initialize();
    const reflexion = new ReflexionMemory(db, embedder);

    // Store an episode (using correct API method)
    await reflexion.storeEpisode({
      sessionId: 'test-session',
      task: 'test backward compatibility',
      reward: 0.95,
      success: true,
      input: 'test input',
      output: 'test output',
      critique: 'working great'
    });

    // Retrieve episodes (using correct API method)
    const results = await reflexion.retrieveRelevant({ task: 'backward compatibility', k: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].task).toContain('backward compatibility');

    console.log('✅ ReflexionMemory working with SQLite');

    db.close();
  });

  it('should work with SkillLibrary on SQLite', async () => {
    const { createDatabase } = await import('../src/db-fallback.js');
    const { SkillLibrary } = await import('../src/controllers/SkillLibrary.js');
    const { EmbeddingService } = await import('../src/controllers/EmbeddingService.js');

    const db = await createDatabase(SQLITE_DB);
    const embedder = new EmbeddingService({
      model: 'Xenova/all-MiniLM-L6-v2',
      dimension: 384,
      provider: 'transformers'
    });
    await embedder.initialize();
    const skills = new SkillLibrary(db, embedder);

    // Create a skill (using correct API method)
    const skillId = await skills.createSkill({
      name: 'test-skill',
      description: 'backward compatibility test',
      code: 'function test() { return true; }',
      successRate: 1.0
    });

    expect(skillId).toBeTruthy();

    // Search for skill (using correct API method)
    const results = await skills.searchSkills({ query: 'test', k: 5 });
    expect(results.length).toBeGreaterThan(0);

    console.log('✅ SkillLibrary working with SQLite');

    db.close();
  });
});

// ADR-0170 Phase A.6: the 'Migration - SQLite to GraphDatabase' describe
// block tested the retired db-unified.ts surface (graph-mode-vs-sqlite-
// legacy switch). PostgreSQL retires both lanes — see ADR-0170
// §"Implementation pre-flight item 2". Phase D adds a different migration
// surface (`agentdb migrate --from sqlite --to pglite`) with its own
// roundtrip contract test at tests/acceptance/adr0170-migration-roundtrip.
// The original migration test below is kept as a `describe.skip(...)` to
// preserve the diff context for Phase D's reviewer.
describe.skip('Migration - SQLite to GraphDatabase (RETIRED — ADR-0170 Phase A.6)', () => {
  it('should detect database mode', async () => {
    // Retired with db-unified.ts deletion (Phase A.6).
  });

  it('should create new graph database', async () => {
    // Retired with db-unified.ts deletion (Phase A.6).
  });

  it('should migrate SQLite to Graph (manual)', async () => {
    const { createDatabase } = await import('../src/db-fallback.js');
    const { GraphDatabaseAdapter } = await import('../src/backends/graph/GraphDatabaseAdapter.js');
    const { EmbeddingService } = await import('../src/controllers/EmbeddingService.js');

    const embedder = new EmbeddingService({
      model: 'Xenova/all-MiniLM-L6-v2',
      dimension: 384,
      provider: 'transformers'
    });
    await embedder.initialize();

    // Create source SQLite database with data
    const sqliteDb = await createDatabase(SQLITE_DB);

    // Insert test episode
    sqliteDb.exec(`
      INSERT INTO episodes (session_id, task, reward, success, input, output, critique, created_at)
      VALUES ('migration-test', 'test migration', 0.95, 1, 'input', 'output', 'critique', ${Date.now()})
    `);

    const episodes = sqliteDb.prepare('SELECT * FROM episodes').all();
    expect(episodes.length).toBeGreaterThan(0);

    console.log(`✅ SQLite has ${episodes.length} episodes to migrate`);

    // Create target GraphDatabase
    const migrationGraphPath = path.join(TEST_DIR, 'migrated.graph');
    const graphDb = new GraphDatabaseAdapter({
      storagePath: migrationGraphPath,
      dimensions: 384
    }, embedder);

    await graphDb.initialize();

    // Migrate episodes (using correct API method)
    for (const ep of episodes) {
      const text = `${ep.task} ${ep.input || ''} ${ep.output || ''}`;
      const embedding = await embedder.embed(text);

      await graphDb.storeEpisode({
        id: `ep-${ep.id}`,
        sessionId: ep.session_id,
        task: ep.task,
        reward: ep.reward,
        success: ep.success === 1,
        input: ep.input,
        output: ep.output,
        critique: ep.critique,
        createdAt: ep.created_at,
        tokensUsed: ep.tokens_used,
        latencyMs: ep.latency_ms
      }, embedding);
    }

    console.log('✅ Manual migration completed');

    // Verify migration
    const stats = await graphDb.getStats();
    expect(stats.totalNodes).toBeGreaterThan(0);

    console.log(`✅ GraphDatabase has ${stats.totalNodes} nodes after migration`);

    sqliteDb.close();
  });
});

describe('MCP Tool Integration', () => {
  it('should validate agentdb_pattern_store schema', async () => {
    const { storePattern } = await import('../src/mcp/agentdb-mcp-server.js').catch(() => ({ storePattern: null }));

    // MCP server exports are optional
    if (storePattern) {
      expect(typeof storePattern).toBe('function');
      console.log('✅ MCP pattern_store tool available');
    } else {
      console.log('ℹ️  MCP server not loaded (optional)');
    }
  });

  it('should validate agentdb_pattern_search schema', async () => {
    const { searchPattern } = await import('../src/mcp/agentdb-mcp-server.js').catch(() => ({ searchPattern: null }));

    if (searchPattern) {
      expect(typeof searchPattern).toBe('function');
      console.log('✅ MCP pattern_search tool available');
    } else {
      console.log('ℹ️  MCP server not loaded (optional)');
    }
  });

  it('should validate agentdb_stats schema', async () => {
    const { getStats } = await import('../src/mcp/agentdb-mcp-server.js').catch(() => ({ getStats: null }));

    if (getStats) {
      expect(typeof getStats).toBe('function');
      console.log('✅ MCP stats tool available');
    } else {
      console.log('ℹ️  MCP server not loaded (optional)');
    }
  });
});

// ADR-0170 Phase A.6: the original "Full Workflow" test exercised the
// retired sqlite→graph autoMigrate path (db-unified.createUnifiedDatabase
// with autoMigrate: true). PostgreSQL retires that surface; Phase D adds
// `agentdb migrate --from sqlite --to pglite` with its own roundtrip
// contract test. The describe.skip preserves diff context for Phase D's
// reviewer.
describe.skip('Integration Test - Full Workflow (RETIRED — ADR-0170 Phase A.6)', () => {
  it('should complete full workflow: CLI init → SQLite ops → Migration → Graph ops', async () => {
    // Retired with db-unified.ts deletion (Phase A.6). See Phase D's
    // tests/acceptance/adr0170-migration-roundtrip.test.mjs for the
    // postgres-substrate replacement.
  });
});
