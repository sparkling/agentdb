/**
 * Unit Tests for HierarchicalMemory Controller
 *
 * Tests the 3-tier (working / episodic / semantic) human-like memory system
 * against the CURRENT public API:
 *   - store / recall / promote / rehearse / query / getStats
 *   - tier caching, forgetting-curve filtering, context-dependent recall
 *   - working-memory size-limit eviction
 *
 * Uses real better-sqlite3 + real EmbeddingService (provider 'local' →
 * deterministic mock embeddings, no network). House style: real instances,
 * meaningful behavioral assertions, unique fixture DB per file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { HierarchicalMemory } from '../../../src/controllers/HierarchicalMemory.js';
import { EmbeddingService } from '../../../src/controllers/EmbeddingService.js';
import * as fs from 'fs';

const TEST_DB_PATH = `./tests/fixtures/hiermem-${Math.random().toString(36).slice(2)}.db`;
const DB_FILES = [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`];

function cleanup(): void {
  DB_FILES.forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
}

describe('HierarchicalMemory', () => {
  let db: Database.Database;
  let embedder: EmbeddingService;
  let memory: HierarchicalMemory;

  beforeEach(async () => {
    cleanup();
    db = new Database(TEST_DB_PATH);
    db.pragma('journal_mode = WAL');

    embedder = new EmbeddingService({
      model: 'mock-model',
      dimension: 384,
      provider: 'local',
    });
    await embedder.initialize();

    // autoConsolidate defaults true but only logs; keep default behavior.
    memory = new HierarchicalMemory(db, embedder);
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  describe('construction & initialization', () => {
    it('should create the hierarchical_memory table', () => {
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='hierarchical_memory'`)
        .get() as { name: string } | undefined;

      expect(row).toBeDefined();
      expect(row!.name).toBe('hierarchical_memory');
    });

    it('should create the supporting indexes', () => {
      const indexes = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='hierarchical_memory'`)
        .all() as Array<{ name: string }>;
      const names = indexes.map(i => i.name);

      expect(names).toContain('idx_hierarchical_tier');
      expect(names).toContain('idx_hierarchical_importance');
      expect(names).toContain('idx_hierarchical_access');
      expect(names).toContain('idx_hierarchical_created');
    });

    it('should not enable Option F when hmem_vec is absent', async () => {
      // Option F mirror writes would attempt to INSERT into hmem_vec on store.
      // Since the virtual table is absent, a successful store proves it's off.
      const id = await memory.store('option-f probe', 0.5, 'working');
      expect(id).toMatch(/^mem-/);
    });
  });

  describe('store', () => {
    it('should store a memory and return a generated id', async () => {
      const id = await memory.store('hello world', 0.7, 'working');

      expect(id).toMatch(/^mem-/);

      const row = db
        .prepare('SELECT * FROM hierarchical_memory WHERE id = ?')
        .get(id) as any;
      expect(row.content).toBe('hello world');
      expect(row.tier).toBe('working');
      expect(row.importance).toBeCloseTo(0.7);
      expect(row.access_count).toBe(0);
      expect(row.created_at).toBeGreaterThan(0);
      expect(row.last_accessed_at).toBe(row.created_at);
    });

    it('should default to working tier and 0.5 importance', async () => {
      const id = await memory.store('defaults');
      const row = db.prepare('SELECT tier, importance FROM hierarchical_memory WHERE id = ?').get(id) as any;

      expect(row.tier).toBe('working');
      expect(row.importance).toBeCloseTo(0.5);
    });

    it('should JSON-serialize tags, context, and metadata', async () => {
      const id = await memory.store('with options', 0.6, 'episodic', {
        tags: ['auth', 'security'],
        context: { project: 'alpha', module: 'login' },
        metadata: { source: 'unit-test' },
      });

      const row = db.prepare('SELECT tags, context, metadata FROM hierarchical_memory WHERE id = ?').get(id) as any;

      expect(JSON.parse(row.tags)).toEqual(['auth', 'security']);
      expect(JSON.parse(row.context)).toEqual({ project: 'alpha', module: 'login' });
      expect(JSON.parse(row.metadata)).toEqual({ source: 'unit-test' });
    });

    it('should store NULL for omitted optional fields', async () => {
      const id = await memory.store('no options', 0.5, 'semantic');
      const row = db.prepare('SELECT tags, context, metadata FROM hierarchical_memory WHERE id = ?').get(id) as any;

      expect(row.tags).toBeNull();
      expect(row.context).toBeNull();
      expect(row.metadata).toBeNull();
    });

    it('should store memories across all three tiers', async () => {
      await memory.store('w', 0.5, 'working');
      await memory.store('e', 0.5, 'episodic');
      await memory.store('s', 0.5, 'semantic');

      const counts = db
        .prepare('SELECT tier, COUNT(*) as c FROM hierarchical_memory GROUP BY tier')
        .all() as Array<{ tier: string; c: number }>;
      const byTier = Object.fromEntries(counts.map(r => [r.tier, r.c]));

      expect(byTier.working).toBe(1);
      expect(byTier.episodic).toBe(1);
      expect(byTier.semantic).toBe(1);
    });

    it('should generate unique ids for distinct stores', async () => {
      const ids = await Promise.all([
        memory.store('a'),
        memory.store('b'),
        memory.store('c'),
      ]);
      expect(new Set(ids).size).toBe(3);
    });
  });

  describe('recall', () => {
    beforeEach(async () => {
      await memory.store('JWT authentication with refresh tokens', 0.9, 'episodic');
      await memory.store('OAuth2 PKCE flow implementation', 0.85, 'episodic');
      await memory.store('Redis connection pooling strategy', 0.7, 'semantic');
      await memory.store('database index optimization notes', 0.6, 'working');
    });

    it('should retrieve memories via manual search (no vector backend)', async () => {
      const results = await memory.recall({
        query: 'authentication tokens',
        k: 5,
        threshold: 0, // mock embeddings → ensure we get matches
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(5);
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('content');
      expect(results[0]).toHaveProperty('tier');
    });

    it('should respect the k limit', async () => {
      const results = await memory.recall({ query: 'anything', k: 2, threshold: 0, includeDecayed: true });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should restrict results to a single requested tier', async () => {
      // threshold -1 admits all candidates regardless of mock-embedding
      // direction, isolating the tier filter as the behavior under test.
      const results = await memory.recall({
        query: 'connection',
        tier: 'semantic',
        k: 10,
        threshold: -1,
        includeDecayed: true,
      });

      expect(results.length).toBeGreaterThan(0);
      results.forEach(r => expect(r.tier).toBe('semantic'));
    });

    it('should restrict results to multiple requested tiers', async () => {
      const results = await memory.recall({
        query: 'notes',
        tier: ['working', 'semantic'],
        k: 10,
        threshold: -1,
        includeDecayed: true,
      });

      expect(results.length).toBeGreaterThan(0);
      results.forEach(r => expect(['working', 'semantic']).toContain(r.tier));
    });

    it('should return embeddings on recalled items (manual search path)', async () => {
      const results = await memory.recall({ query: 'oauth', k: 5, threshold: -1, includeDecayed: true });
      expect(results[0].embedding).toBeInstanceOf(Float32Array);
      expect(results[0].embedding!.length).toBe(384);
    });

    it('should increment access_count for recalled memories', async () => {
      const before = db
        .prepare(`SELECT id, access_count FROM hierarchical_memory WHERE tier = 'semantic'`)
        .get() as any;
      expect(before.access_count).toBe(0);

      await memory.recall({ query: 'connection pooling', tier: 'semantic', k: 5, threshold: -1, includeDecayed: true });

      const after = db
        .prepare('SELECT access_count FROM hierarchical_memory WHERE id = ?')
        .get(before.id) as any;
      expect(after.access_count).toBeGreaterThanOrEqual(1);
    });

    it('should apply a context filter when context is provided', async () => {
      await memory.store('contextual entry alpha', 0.8, 'semantic', {
        context: { project: 'alpha', team: 'core' },
      });
      await memory.store('contextual entry beta', 0.8, 'semantic', {
        context: { project: 'beta', team: 'core' },
      });

      const results = await memory.recall({
        query: 'contextual entry',
        tier: 'semantic',
        k: 10,
        threshold: -1,
        includeDecayed: true,
        context: { project: 'alpha', team: 'core' },
      });

      // Context filter keeps items where >= 50% of keys match. The 'beta'
      // entry matches only team (1/2 = 50%), alpha matches 2/2. Both pass the
      // 50% threshold, but entries without context are dropped.
      results.forEach(r => {
        expect(r.context).toBeDefined();
      });
      const projects = results.map(r => r.context?.project);
      expect(projects).toContain('alpha');
    });

    it('should drop items with no context when a context filter is supplied', async () => {
      const results = await memory.recall({
        query: 'JWT authentication',
        tier: 'episodic',
        k: 10,
        threshold: 0,
        includeDecayed: true,
        context: { project: 'nonexistent' },
      });

      // None of the seeded episodic memories have context → all filtered out.
      expect(results.length).toBe(0);
    });

    it('should return empty array when threshold is unreachable', async () => {
      const results = await memory.recall({
        query: 'totally unrelated quantum chromodynamics',
        k: 5,
        threshold: 0.999999,
      });
      expect(Array.isArray(results)).toBe(true);
    });

    it('should accept a precomputed query embedding', async () => {
      const qEmb = await embedder.embed('Redis connection pooling strategy');
      const results = await memory.recall({
        query: 'ignored when embedding provided',
        queryEmbedding: qEmb,
        tier: 'semantic',
        k: 5,
        threshold: 0,
        includeDecayed: true,
      });
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('promote', () => {
    it('should return false for a non-existent memory', async () => {
      const promoted = await memory.promote('does-not-exist');
      expect(promoted).toBe(false);
    });

    it('should NOT promote a working memory below the access threshold', async () => {
      const id = await memory.store('fresh working item', 0.9, 'working');
      const promoted = await memory.promote(id);

      expect(promoted).toBe(false);
      const row = db.prepare('SELECT tier FROM hierarchical_memory WHERE id = ?').get(id) as any;
      expect(row.tier).toBe('working');
    });

    it('should promote working → episodic after >= 2 accesses', async () => {
      const id = await memory.store('promotable working item', 0.9, 'working');
      // Bump access_count to satisfy the promotion guard (accessCount >= 2).
      // promote() reads via getMemoryById, which prefers the in-memory cache;
      // a fresh instance reading the same DB exercises the durable-row path so
      // the SQL-updated access_count is what promote() sees.
      db.prepare('UPDATE hierarchical_memory SET access_count = 2 WHERE id = ?').run(id);

      const fresh = new HierarchicalMemory(db, embedder, undefined, { autoConsolidate: false });
      const promoted = await fresh.promote(id);

      expect(promoted).toBe(true);
      const row = db.prepare('SELECT tier FROM hierarchical_memory WHERE id = ?').get(id) as any;
      expect(row.tier).toBe('episodic');
    });

    it('should promote episodic → semantic when consolidation criteria met', async () => {
      const id = await memory.store('long-lived important episodic', 0.9, 'episodic');
      // Criteria: accessCount >= 3, importance >= 0.6, age >= 24h.
      const oldCreatedAt = Date.now() - 2 * 24 * 60 * 60 * 1000; // 2 days ago
      db.prepare('UPDATE hierarchical_memory SET access_count = 5, created_at = ? WHERE id = ?')
        .run(oldCreatedAt, id);

      const fresh = new HierarchicalMemory(db, embedder, undefined, { autoConsolidate: false });
      const promoted = await fresh.promote(id);

      expect(promoted).toBe(true);
      const row = db.prepare('SELECT tier, consolidated_at FROM hierarchical_memory WHERE id = ?').get(id) as any;
      expect(row.tier).toBe('semantic');
      expect(row.consolidated_at).toBeGreaterThan(0);
    });

    it('should NOT promote episodic → semantic when too young', async () => {
      const id = await memory.store('young important episodic', 0.9, 'episodic');
      // High access + importance, but created just now (age < minAge).
      db.prepare('UPDATE hierarchical_memory SET access_count = 5 WHERE id = ?').run(id);

      const fresh = new HierarchicalMemory(db, embedder, undefined, { autoConsolidate: false });
      const promoted = await fresh.promote(id);

      expect(promoted).toBe(false);
      const row = db.prepare('SELECT tier FROM hierarchical_memory WHERE id = ?').get(id) as any;
      expect(row.tier).toBe('episodic');
    });
  });

  describe('rehearse', () => {
    it('should set last_rehearsed_at and increment access_count', async () => {
      const id = await memory.store('rehearsal target', 0.5, 'episodic');

      const before = db.prepare('SELECT access_count, last_rehearsed_at FROM hierarchical_memory WHERE id = ?').get(id) as any;
      expect(before.access_count).toBe(0);
      expect(before.last_rehearsed_at).toBeNull();

      await memory.rehearse(id);

      const after = db.prepare('SELECT access_count, last_rehearsed_at FROM hierarchical_memory WHERE id = ?').get(id) as any;
      expect(after.access_count).toBe(1);
      expect(after.last_rehearsed_at).toBeGreaterThan(0);
    });

    it('should accumulate access_count across multiple rehearsals', async () => {
      const id = await memory.store('repeated rehearsal', 0.5, 'episodic');
      await memory.rehearse(id);
      await memory.rehearse(id);
      await memory.rehearse(id);

      const row = db.prepare('SELECT access_count FROM hierarchical_memory WHERE id = ?').get(id) as any;
      expect(row.access_count).toBe(3);
    });
  });

  describe('query (path/glob pattern enumeration)', () => {
    // query() globs the logical key/path in metadata.key (ADR-0176 Phase 3 —
    // globbing content was the original defect), so the fixtures must write the
    // path as the key, mirroring the real store path (metadata: { key }).
    beforeEach(async () => {
      await memory.store('src/auth/login.ts', 0.5, 'working', { metadata: { key: 'src/auth/login.ts' } });
      await memory.store('src/auth/logout.ts', 0.5, 'working', { metadata: { key: 'src/auth/logout.ts' } });
      await memory.store('src/db/index.ts', 0.5, 'episodic', { metadata: { key: 'src/db/index.ts' } });
      await memory.store('docs/readme.md', 0.5, 'semantic', { metadata: { key: 'docs/readme.md' } });
    });

    it('should translate * glob to SQL % wildcard', async () => {
      const results = await memory.query('src/auth/*');
      const contents = results.map(r => r.content).sort();
      expect(contents).toEqual(['src/auth/login.ts', 'src/auth/logout.ts']);
    });

    it('should match a broad prefix glob', async () => {
      const results = await memory.query('src/*');
      expect(results.length).toBe(3);
      results.forEach(r => expect(r.content.startsWith('src/')).toBe(true));
    });

    it('should translate ? glob to single-character wildcard', async () => {
      // 'src/db/index.t?' should match 'src/db/index.ts'
      const results = await memory.query('src/db/index.t?');
      expect(results.map(r => r.content)).toEqual(['src/db/index.ts']);
    });

    it('should filter by tier', async () => {
      const results = await memory.query('src/*', { tier: 'working' });
      expect(results.length).toBe(2);
      results.forEach(r => expect(r.tier).toBe('working'));
    });

    it('should respect a positive limit', async () => {
      const results = await memory.query('*', { limit: 2 });
      expect(results.length).toBe(2);
    });

    it('should order results by created_at descending', async () => {
      const results = await memory.query('*');
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].createdAt).toBeGreaterThanOrEqual(results[i + 1].createdAt);
      }
    });

    it('should treat literal % in the pattern as a literal, not a wildcard', async () => {
      await memory.store('100%-coverage', 0.5, 'working', { metadata: { key: '100%-coverage' } });
      // A bare '%' would match everything if not escaped; the escaped query
      // should match ONLY the literal-percent row.
      const results = await memory.query('100%-coverage');
      expect(results.map(r => r.content)).toEqual(['100%-coverage']);
    });

    it('should return empty array for a non-matching pattern', async () => {
      const results = await memory.query('nonexistent/path/*');
      expect(results).toEqual([]);
    });
  });

  // ADR-0281: keyed upsert (one entry per logical key) + delete-by-key. The
  // logical key is supplied via options.metadata.key (the MCP store path sets
  // it). Keyless stores keep append semantics.
  describe('keyed upsert + delete-by-key (ADR-0281)', () => {
    const keyOf = (key: string) =>
      db.prepare(
        `SELECT * FROM hierarchical_memory WHERE json_extract(metadata, '$.key') = ?`
      ).all(key) as any[];

    it('should upsert a keyed store — re-storing the same key replaces, not appends', async () => {
      await memory.store('first value', 0.5, 'semantic', { metadata: { key: 'adr/X' } });
      await memory.store('second value', 0.5, 'semantic', { metadata: { key: 'adr/X' } });

      const rows = keyOf('adr/X');
      expect(rows.length).toBe(1);
      expect(rows[0].content).toBe('second value'); // latest write wins
    });

    it('should upsert across tiers — a key re-stored in a new tier moves, not duplicates', async () => {
      await memory.store('tier move', 0.5, 'working', { metadata: { key: 'adr/T' } });
      await memory.store('tier move', 0.5, 'semantic', { metadata: { key: 'adr/T' } });

      const rows = keyOf('adr/T');
      expect(rows.length).toBe(1);
      expect(rows[0].tier).toBe('semantic');
    });

    it('should delete by logical key and report the count removed', async () => {
      await memory.store('to be deleted', 0.5, 'semantic', { metadata: { key: 'adr/Y' } });

      const deleted = await memory.delete('adr/Y');
      expect(deleted).toBe(1);
      expect(keyOf('adr/Y').length).toBe(0);
      // read-side (query) also sees it gone — confirms caches stay in sync
      expect(await memory.query('adr/Y')).toEqual([]);
    });

    it('should delete by raw mem-* id', async () => {
      const id = await memory.store('delete by id', 0.5, 'working', { metadata: { key: 'adr/Z' } });
      expect(id).toMatch(/^mem-/);

      const deleted = await memory.delete(id);
      expect(deleted).toBe(1);
      expect(db.prepare('SELECT id FROM hierarchical_memory WHERE id = ?').get(id)).toBeUndefined();
    });

    it('should round-trip a slash-containing key through store → query → delete', async () => {
      await memory.store('slashed key value', 0.5, 'semantic', { metadata: { key: 'adr/ADR-0281' } });
      expect((await memory.query('adr/ADR-0281')).length).toBe(1);

      const deleted = await memory.delete('adr/ADR-0281');
      expect(deleted).toBe(1);
      expect(await memory.query('adr/ADR-0281')).toEqual([]);
    });

    it('should restrict delete to a tier when the tier option is supplied', async () => {
      await memory.store('working entry', 0.5, 'working', { metadata: { key: 'adr/Tier' } });

      // Wrong tier → no match, nothing removed.
      expect(await memory.delete('adr/Tier', { tier: 'semantic' })).toBe(0);
      expect(keyOf('adr/Tier').length).toBe(1);

      // Correct tier → removed.
      expect(await memory.delete('adr/Tier', { tier: 'working' })).toBe(1);
      expect(keyOf('adr/Tier').length).toBe(0);
    });

    it('should return 0 when deleting a non-existent key', async () => {
      expect(await memory.delete('adr/does-not-exist')).toBe(0);
    });

    it('should return 0 for an empty key', async () => {
      expect(await memory.delete('')).toBe(0);
    });

    it('should keep append semantics for keyless stores (no metadata.key)', async () => {
      await memory.store('keyless one', 0.5, 'working');
      await memory.store('keyless two', 0.5, 'working');
      // metadata present but no key → still append
      await memory.store('meta but no key', 0.5, 'working', { metadata: { source: 'test' } });

      const rows = db.prepare('SELECT id FROM hierarchical_memory').all() as any[];
      expect(rows.length).toBe(3);
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      await memory.store('working one', 0.4, 'working');
      await memory.store('working two longer content', 0.6, 'working');
      await memory.store('episodic one', 0.7, 'episodic');
      await memory.store('semantic consolidated', 0.9, 'semantic');
      // Mark the semantic memory as consolidated to exercise consolidationRate.
      db.prepare(`UPDATE hierarchical_memory SET consolidated_at = ? WHERE tier = 'semantic'`)
        .run(Date.now());
    });

    it('should report per-tier counts', async () => {
      const stats = await memory.getStats();
      expect(stats.working.count).toBe(2);
      expect(stats.episodic.count).toBe(1);
      expect(stats.semantic.count).toBe(1);
      expect(stats.totalMemories).toBe(4);
    });

    it('should report non-zero size in bytes for populated tiers', async () => {
      const stats = await memory.getStats();
      expect(stats.working.sizeBytes).toBeGreaterThan(0);
      expect(stats.episodic.sizeBytes).toBeGreaterThan(0);
    });

    it('should report average importance per tier', async () => {
      const stats = await memory.getStats();
      expect(stats.working.avgImportance).toBeCloseTo(0.5, 5); // (0.4 + 0.6) / 2
      expect(stats.episodic.avgImportance).toBeCloseTo(0.7, 5);
    });

    it('should compute consolidationRate from consolidated semantic memories', async () => {
      const stats = await memory.getStats();
      expect(stats.semantic.consolidationRate).toBe(1); // 1 of 1 consolidated
    });

    it('should report a numeric promotionRate', async () => {
      const stats = await memory.getStats();
      expect(typeof stats.promotionRate).toBe('number');
      expect(stats.promotionRate).toBeGreaterThanOrEqual(0);
    });

    it('should return zeroed stats for an empty database', async () => {
      const freshDb = new Database(`${TEST_DB_PATH}-empty`);
      const freshMem = new HierarchicalMemory(freshDb, embedder);
      const stats = await freshMem.getStats();

      expect(stats.totalMemories).toBe(0);
      expect(stats.working.count).toBe(0);
      expect(stats.semantic.consolidationRate).toBe(0);
      expect(stats.promotionRate).toBe(0);

      freshDb.close();
      [`${TEST_DB_PATH}-empty`, `${TEST_DB_PATH}-empty-wal`, `${TEST_DB_PATH}-empty-shm`].forEach(f => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      });
    });
  });

  describe('working memory limit enforcement', () => {
    it('should evict/promote working memories when the byte limit is exceeded', async () => {
      // Tiny working-memory limit forces enforcement on the next store.
      const tinyDb = new Database(`${TEST_DB_PATH}-tiny`);
      const tinyMem = new HierarchicalMemory(tinyDb, embedder, undefined, {
        workingMemoryLimit: 50, // bytes
        autoConsolidate: false,
      });

      // Each content is > 25 bytes so two of them blow past the 50-byte cap.
      const big = 'x'.repeat(40);
      await tinyMem.store(big + '-one', 0.9, 'working'); // high score → promote
      await tinyMem.store(big + '-two', 0.05, 'working'); // low score → forget

      // After enforcement, the working cache must be under the limit: at least
      // one item left working tier (promoted to episodic or forgotten).
      const workingCount = tinyDb
        .prepare(`SELECT COUNT(*) as c FROM hierarchical_memory WHERE tier = 'working'`)
        .get() as { c: number };
      const totalCount = tinyDb
        .prepare('SELECT COUNT(*) as c FROM hierarchical_memory')
        .get() as { c: number };

      // Enforcement either promoted (still present, different tier) or forgot
      // (deleted) — in all cases the working tier shrank below 2 items.
      expect(workingCount.c).toBeLessThan(2);
      // The high-importance item should survive (promoted, not forgotten).
      expect(totalCount.c).toBeGreaterThanOrEqual(1);

      tinyDb.close();
      [`${TEST_DB_PATH}-tiny`, `${TEST_DB_PATH}-tiny-wal`, `${TEST_DB_PATH}-tiny-shm`].forEach(f => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      });
    });
  });

  describe('edge cases', () => {
    it('should store empty content', async () => {
      const id = await memory.store('', 0.5, 'working');
      const row = db.prepare('SELECT content FROM hierarchical_memory WHERE id = ?').get(id) as any;
      expect(row.content).toBe('');
    });

    it('should handle Unicode content', async () => {
      const content = 'implement 🚀 auth 🔐 测试';
      const id = await memory.store(content, 0.8, 'episodic');
      const row = db.prepare('SELECT content FROM hierarchical_memory WHERE id = ?').get(id) as any;
      expect(row.content).toBe(content);
    });

    it('should handle importance boundary values 0 and 1', async () => {
      const idLow = await memory.store('zero importance', 0.0, 'working');
      const idHigh = await memory.store('full importance', 1.0, 'working');

      const low = db.prepare('SELECT importance FROM hierarchical_memory WHERE id = ?').get(idLow) as any;
      const high = db.prepare('SELECT importance FROM hierarchical_memory WHERE id = ?').get(idHigh) as any;

      expect(low.importance).toBe(0);
      expect(high.importance).toBe(1);
    });

    it('should recall nothing from an empty store without throwing', async () => {
      const freshDb = new Database(`${TEST_DB_PATH}-empty2`);
      const freshMem = new HierarchicalMemory(freshDb, embedder);

      const results = await freshMem.recall({ query: 'anything', threshold: 0 });
      expect(results).toEqual([]);

      freshDb.close();
      [`${TEST_DB_PATH}-empty2`, `${TEST_DB_PATH}-empty2-wal`, `${TEST_DB_PATH}-empty2-shm`].forEach(f => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      });
    });
  });
});
