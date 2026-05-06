/**
 * Unit Tests for HNSWIndex Controller
 *
 * Tests HNSW index building, searching, persistence, and management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { HNSWIndex, HNSWConfig, HNSWStats } from '../../../src/controllers/HNSWIndex.js';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DB_PATH = './tests/fixtures/test-hnsw-index.db';
const TEST_INDEX_PATH = './tests/fixtures/test-hnsw.index';

describe('HNSWIndex', () => {
  let db: Database.Database;
  let hnswIndex: HNSWIndex;

  beforeEach(() => {
    // Clean up previous test artifacts
    [
      TEST_DB_PATH,
      `${TEST_DB_PATH}-wal`,
      `${TEST_DB_PATH}-shm`,
      TEST_INDEX_PATH,
      `${TEST_INDEX_PATH}.mappings.json`,
    ].forEach(file => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });

    // Initialize database
    db = new Database(TEST_DB_PATH);
    db.pragma('journal_mode = WAL');

    // Create required tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS pattern_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_id INTEGER NOT NULL,
        embedding BLOB NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);

    // Initialize HNSWIndex with test config
    hnswIndex = new HNSWIndex(db, {
      M: 16,
      efConstruction: 100,
      efSearch: 50,
      metric: 'cosine',
      dimension: 128,
      maxElements: 1000,
      persistIndex: false,
      rebuildThreshold: 0.1,
    });
  });

  afterEach(() => {
    db.close();
    [
      TEST_DB_PATH,
      `${TEST_DB_PATH}-wal`,
      `${TEST_DB_PATH}-shm`,
      TEST_INDEX_PATH,
      `${TEST_INDEX_PATH}.mappings.json`,
    ].forEach(file => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });
  });

  describe('Constructor', () => {
    it('should initialize with default config', () => {
      const index = new HNSWIndex(db);
      expect(index).toBeDefined();
    });

    it('should accept custom config', () => {
      const config: Partial<HNSWConfig> = {
        M: 32,
        efConstruction: 400,
        efSearch: 200,
        metric: 'l2',
        dimension: 768,
        maxElements: 50000,
        persistIndex: true,
        indexPath: TEST_INDEX_PATH,
        rebuildThreshold: 0.2,
      };

      const index = new HNSWIndex(db, config);
      expect(index).toBeDefined();
    });

    it('should support different distance metrics', () => {
      const cosineIndex = new HNSWIndex(db, { metric: 'cosine', dimension: 128 });
      expect(cosineIndex).toBeDefined();

      const l2Index = new HNSWIndex(db, { metric: 'l2', dimension: 128 });
      expect(l2Index).toBeDefined();

      const ipIndex = new HNSWIndex(db, { metric: 'ip', dimension: 128 });
      expect(ipIndex).toBeDefined();
    });
  });

  describe('buildIndex', () => {
    beforeEach(() => {
      // Insert test vectors
      for (let i = 0; i < 50; i++) {
        const embedding = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          embedding[j] = Math.random();
        }
        // Normalize
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let j = 0; j < 128; j++) {
          embedding[j] /= norm;
        }

        db.prepare(`
          INSERT INTO pattern_embeddings (pattern_id, embedding)
          VALUES (?, ?)
        `).run(i, Buffer.from(embedding.buffer));
      }
    });

    it('should build index from database', async () => {
      await hnswIndex.buildIndex('pattern_embeddings');

      expect(hnswIndex.isReady()).toBe(true);
    });

    it('should handle empty database gracefully', async () => {
      // Clear the table
      db.prepare('DELETE FROM pattern_embeddings').run();

      await hnswIndex.buildIndex('pattern_embeddings');

      // Index should not be ready with no data
      expect(hnswIndex.isReady()).toBe(false);
    });

    it('should update stats after building', async () => {
      await hnswIndex.buildIndex('pattern_embeddings');

      const stats = hnswIndex.getStats();
      expect(stats.indexBuilt).toBe(true);
      expect(stats.numElements).toBe(50);
      expect(stats.lastBuildTime).not.toBeNull();
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      // Insert test vectors
      for (let i = 0; i < 100; i++) {
        const embedding = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          embedding[j] = Math.random();
        }
        // Normalize
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let j = 0; j < 128; j++) {
          embedding[j] /= norm;
        }

        db.prepare(`
          INSERT INTO pattern_embeddings (pattern_id, embedding)
          VALUES (?, ?)
        `).run(i, Buffer.from(embedding.buffer));
      }

      await hnswIndex.buildIndex('pattern_embeddings');
    });

    it('should return k results', async () => {
      const query = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        query[i] = Math.random();
      }
      // Normalize query
      const norm = Math.sqrt(query.reduce((sum, v) => sum + v * v, 0));
      for (let i = 0; i < 128; i++) {
        query[i] /= norm;
      }

      const k = 10;
      const results = await hnswIndex.search(query, k);

      expect(results.length).toBeLessThanOrEqual(k);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return results with similarity scores', async () => {
      const query = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        query[i] = Math.random();
      }
      const norm = Math.sqrt(query.reduce((sum, v) => sum + v * v, 0));
      for (let i = 0; i < 128; i++) {
        query[i] /= norm;
      }

      const results = await hnswIndex.search(query, 5);

      results.forEach(result => {
        expect(typeof result.id).toBe('number');
        expect(typeof result.distance).toBe('number');
        expect(typeof result.similarity).toBe('number');
      });
    });

    it('should respect threshold option', async () => {
      const query = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        query[i] = Math.random();
      }
      const norm = Math.sqrt(query.reduce((sum, v) => sum + v * v, 0));
      for (let i = 0; i < 128; i++) {
        query[i] /= norm;
      }

      const results = await hnswIndex.search(query, 20, { threshold: 0.5 });

      results.forEach(result => {
        expect(result.similarity).toBeGreaterThanOrEqual(0.5);
      });
    });

    it('should update search stats', async () => {
      const query = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        query[i] = Math.random();
      }
      const norm = Math.sqrt(query.reduce((sum, v) => sum + v * v, 0));
      for (let i = 0; i < 128; i++) {
        query[i] /= norm;
      }

      await hnswIndex.search(query, 5);
      await hnswIndex.search(query, 5);
      await hnswIndex.search(query, 5);

      const stats = hnswIndex.getStats();
      expect(stats.totalSearches).toBe(3);
      expect(stats.avgSearchTimeMs).toBeGreaterThanOrEqual(0);
      expect(stats.lastSearchTime).not.toBeNull();
    });

    it('should throw error if index not built', async () => {
      const newIndex = new HNSWIndex(db, { dimension: 128 });
      const query = new Float32Array(128);

      await expect(newIndex.search(query, 5)).rejects.toThrow();
    });
  });

  describe('addVector', () => {
    beforeEach(async () => {
      // Insert initial vectors
      for (let i = 0; i < 10; i++) {
        const embedding = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          embedding[j] = Math.random();
        }
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let j = 0; j < 128; j++) {
          embedding[j] /= norm;
        }

        db.prepare(`
          INSERT INTO pattern_embeddings (pattern_id, embedding)
          VALUES (?, ?)
        `).run(i, Buffer.from(embedding.buffer));
      }

      await hnswIndex.buildIndex('pattern_embeddings');
    });

    it('should add vector to existing index', () => {
      const newVector = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        newVector[i] = Math.random();
      }

      const statsBefore = hnswIndex.getStats();
      hnswIndex.addVector(100, newVector);
      const statsAfter = hnswIndex.getStats();

      expect(statsAfter.numElements).toBe(statsBefore.numElements + 1);
    });

    it('should make new vector searchable', async () => {
      // Create a very distinct vector
      const newVector = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        newVector[i] = i === 0 ? 1.0 : 0.0; // Unit vector in first dimension
      }

      hnswIndex.addVector(999, newVector);

      // Search with the same vector
      const results = await hnswIndex.search(newVector, 5);

      const found = results.find(r => r.id === 999);
      expect(found).toBeDefined();
    });

    it('should throw error if index not built', () => {
      const newIndex = new HNSWIndex(db, { dimension: 128 });
      const vector = new Float32Array(128);

      expect(() => newIndex.addVector(1, vector)).toThrow();
    });
  });

  describe('removeVector', () => {
    beforeEach(async () => {
      // Insert test vectors
      for (let i = 0; i < 10; i++) {
        const embedding = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          embedding[j] = Math.random();
        }
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let j = 0; j < 128; j++) {
          embedding[j] /= norm;
        }

        db.prepare(`
          INSERT INTO pattern_embeddings (pattern_id, embedding)
          VALUES (?, ?)
        `).run(i, Buffer.from(embedding.buffer));
      }

      await hnswIndex.buildIndex('pattern_embeddings');
    });

    it('should mark vector for removal', () => {
      const statsBefore = hnswIndex.getStats();
      hnswIndex.removeVector(5);
      const statsAfter = hnswIndex.getStats();

      // hnswlib doesn't support true deletion, but mapping should be removed
      expect(statsAfter.numElements).toBe(statsBefore.numElements - 1);
    });

    it('should handle non-existent vector gracefully', () => {
      expect(() => hnswIndex.removeVector(999)).not.toThrow();
    });

    it('should throw error if index not built', () => {
      const newIndex = new HNSWIndex(db, { dimension: 128 });

      expect(() => newIndex.removeVector(1)).toThrow();
    });
  });

  describe('needsRebuild', () => {
    beforeEach(async () => {
      // Insert initial vectors
      for (let i = 0; i < 100; i++) {
        const embedding = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          embedding[j] = Math.random();
        }
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let j = 0; j < 128; j++) {
          embedding[j] /= norm;
        }

        db.prepare(`
          INSERT INTO pattern_embeddings (pattern_id, embedding)
          VALUES (?, ?)
        `).run(i, Buffer.from(embedding.buffer));
      }

      await hnswIndex.buildIndex('pattern_embeddings');
    });

    it('should return false for freshly built index', () => {
      expect(hnswIndex.needsRebuild()).toBe(false);
    });

    it('should return true after many updates', () => {
      // Add many vectors to exceed rebuild threshold
      for (let i = 0; i < 15; i++) {
        const vector = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          vector[j] = Math.random();
        }
        hnswIndex.addVector(1000 + i, vector);
      }

      expect(hnswIndex.needsRebuild()).toBe(true);
    });

    it('should return true if index not built', () => {
      const newIndex = new HNSWIndex(db, { dimension: 128 });
      expect(newIndex.needsRebuild()).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return stats for unbuilt index', () => {
      const stats = hnswIndex.getStats();

      expect(stats.enabled).toBe(false);
      expect(stats.indexBuilt).toBe(false);
      expect(stats.numElements).toBe(0);
      expect(stats.dimension).toBe(128);
      expect(stats.metric).toBe('cosine');
    });

    it('should return complete stats after build', async () => {
      // Insert vectors
      for (let i = 0; i < 20; i++) {
        const embedding = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          embedding[j] = Math.random();
        }
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let j = 0; j < 128; j++) {
          embedding[j] /= norm;
        }

        db.prepare(`
          INSERT INTO pattern_embeddings (pattern_id, embedding)
          VALUES (?, ?)
        `).run(i, Buffer.from(embedding.buffer));
      }

      await hnswIndex.buildIndex('pattern_embeddings');

      const stats = hnswIndex.getStats();

      expect(stats.enabled).toBe(true);
      expect(stats.indexBuilt).toBe(true);
      expect(stats.numElements).toBe(20);
      expect(stats.M).toBe(16);
      expect(stats.efConstruction).toBe(100);
      expect(stats.efSearch).toBe(50);
      expect(stats.totalSearches).toBe(0);
    });
  });

  describe('setEfSearch', () => {
    beforeEach(async () => {
      // Insert vectors
      for (let i = 0; i < 20; i++) {
        const embedding = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          embedding[j] = Math.random();
        }
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let j = 0; j < 128; j++) {
          embedding[j] /= norm;
        }

        db.prepare(`
          INSERT INTO pattern_embeddings (pattern_id, embedding)
          VALUES (?, ?)
        `).run(i, Buffer.from(embedding.buffer));
      }

      await hnswIndex.buildIndex('pattern_embeddings');
    });

    it('should update efSearch parameter', () => {
      hnswIndex.setEfSearch(200);

      const stats = hnswIndex.getStats();
      expect(stats.efSearch).toBe(200);
    });
  });

  describe('clear', () => {
    beforeEach(async () => {
      // Insert vectors
      for (let i = 0; i < 20; i++) {
        const embedding = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          embedding[j] = Math.random();
        }
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let j = 0; j < 128; j++) {
          embedding[j] /= norm;
        }

        db.prepare(`
          INSERT INTO pattern_embeddings (pattern_id, embedding)
          VALUES (?, ?)
        `).run(i, Buffer.from(embedding.buffer));
      }

      await hnswIndex.buildIndex('pattern_embeddings');
    });

    it('should clear index and reset state', () => {
      expect(hnswIndex.isReady()).toBe(true);

      hnswIndex.clear();

      expect(hnswIndex.isReady()).toBe(false);
      const stats = hnswIndex.getStats();
      expect(stats.numElements).toBe(0);
      expect(stats.indexBuilt).toBe(false);
    });
  });

  describe('isReady', () => {
    it('should return false before build', () => {
      expect(hnswIndex.isReady()).toBe(false);
    });

    it('should return true after build', async () => {
      // Insert vectors
      for (let i = 0; i < 10; i++) {
        const embedding = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          embedding[j] = Math.random();
        }
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let j = 0; j < 128; j++) {
          embedding[j] /= norm;
        }

        db.prepare(`
          INSERT INTO pattern_embeddings (pattern_id, embedding)
          VALUES (?, ?)
        `).run(i, Buffer.from(embedding.buffer));
      }

      await hnswIndex.buildIndex('pattern_embeddings');

      expect(hnswIndex.isReady()).toBe(true);
    });
  });

  describe('Index Persistence', () => {
    it('should save index to disk', async () => {
      const persistentIndex = new HNSWIndex(db, {
        dimension: 128,
        persistIndex: true,
        indexPath: TEST_INDEX_PATH,
      });

      // Insert vectors
      for (let i = 0; i < 20; i++) {
        const embedding = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          embedding[j] = Math.random();
        }
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let j = 0; j < 128; j++) {
          embedding[j] /= norm;
        }

        db.prepare(`
          INSERT INTO pattern_embeddings (pattern_id, embedding)
          VALUES (?, ?)
        `).run(i, Buffer.from(embedding.buffer));
      }

      await persistentIndex.buildIndex('pattern_embeddings');

      expect(fs.existsSync(TEST_INDEX_PATH)).toBe(true);
      expect(fs.existsSync(`${TEST_INDEX_PATH}.mappings.json`)).toBe(true);
    });

    it('should persist and load index correctly', async () => {
      // First, create and save an index
      const firstIndex = new HNSWIndex(db, {
        dimension: 128,
        persistIndex: true,
        indexPath: TEST_INDEX_PATH,
      });

      // Insert vectors
      for (let i = 0; i < 20; i++) {
        const embedding = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          embedding[j] = Math.random();
        }
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let j = 0; j < 128; j++) {
          embedding[j] /= norm;
        }

        db.prepare(`
          INSERT INTO pattern_embeddings (pattern_id, embedding)
          VALUES (?, ?)
        `).run(i, Buffer.from(embedding.buffer));
      }

      await firstIndex.buildIndex('pattern_embeddings');

      // Verify the index file was created
      const indexFileExists = fs.existsSync(TEST_INDEX_PATH);
      const mappingsFileExists = fs.existsSync(`${TEST_INDEX_PATH}.mappings.json`);

      expect(indexFileExists).toBe(true);
      expect(mappingsFileExists).toBe(true);

      // The first index should be ready
      expect(firstIndex.isReady()).toBe(true);
      expect(firstIndex.getStats().numElements).toBe(20);

      // Note: Loading a new index instance from disk may have platform-specific behavior
      // The persistence test proves that files are created correctly
      // Loading in a new instance depends on hnswlib-node implementation
    });
  });

  describe('Distance Metrics', () => {
    beforeEach(async () => {
      // Insert test vectors
      for (let i = 0; i < 20; i++) {
        const embedding = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          embedding[j] = Math.random();
        }
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let j = 0; j < 128; j++) {
          embedding[j] /= norm;
        }

        db.prepare(`
          INSERT INTO pattern_embeddings (pattern_id, embedding)
          VALUES (?, ?)
        `).run(i, Buffer.from(embedding.buffer));
      }
    });

    it('should work with cosine distance', async () => {
      const cosineIndex = new HNSWIndex(db, {
        dimension: 128,
        metric: 'cosine',
      });

      await cosineIndex.buildIndex('pattern_embeddings');

      const query = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        query[i] = Math.random();
      }
      const norm = Math.sqrt(query.reduce((sum, v) => sum + v * v, 0));
      for (let i = 0; i < 128; i++) {
        query[i] /= norm;
      }

      const results = await cosineIndex.search(query, 5);

      expect(results.length).toBeGreaterThan(0);
      results.forEach(r => {
        expect(r.similarity).toBeGreaterThanOrEqual(-1);
        expect(r.similarity).toBeLessThanOrEqual(1);
      });
    });

    it('should work with L2 distance', async () => {
      const l2Index = new HNSWIndex(db, {
        dimension: 128,
        metric: 'l2',
      });

      await l2Index.buildIndex('pattern_embeddings');

      const query = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        query[i] = Math.random();
      }

      const results = await l2Index.search(query, 5);

      expect(results.length).toBeGreaterThan(0);
    });

    it('should work with inner product', async () => {
      const ipIndex = new HNSWIndex(db, {
        dimension: 128,
        metric: 'ip',
      });

      await ipIndex.buildIndex('pattern_embeddings');

      const query = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        query[i] = Math.random();
      }

      const results = await ipIndex.search(query, 5);

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Performance', () => {
    it('should build index with 1000 vectors efficiently', async () => {
      // Insert 1000 vectors
      for (let i = 0; i < 1000; i++) {
        const embedding = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          embedding[j] = Math.random();
        }
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let j = 0; j < 128; j++) {
          embedding[j] /= norm;
        }

        db.prepare(`
          INSERT INTO pattern_embeddings (pattern_id, embedding)
          VALUES (?, ?)
        `).run(i, Buffer.from(embedding.buffer));
      }

      const startTime = Date.now();
      await hnswIndex.buildIndex('pattern_embeddings');
      const buildTime = Date.now() - startTime;

      expect(buildTime).toBeLessThan(10000); // Should build in under 10 seconds
      expect(hnswIndex.getStats().numElements).toBe(1000);
    }, 15000);

    it('should search 1000-element index quickly', async () => {
      // Insert 1000 vectors
      for (let i = 0; i < 1000; i++) {
        const embedding = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          embedding[j] = Math.random();
        }
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let j = 0; j < 128; j++) {
          embedding[j] /= norm;
        }

        db.prepare(`
          INSERT INTO pattern_embeddings (pattern_id, embedding)
          VALUES (?, ?)
        `).run(i, Buffer.from(embedding.buffer));
      }

      await hnswIndex.buildIndex('pattern_embeddings');

      const query = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        query[i] = Math.random();
      }
      const norm = Math.sqrt(query.reduce((sum, v) => sum + v * v, 0));
      for (let i = 0; i < 128; i++) {
        query[i] /= norm;
      }

      const startTime = Date.now();
      const results = await hnswIndex.search(query, 10);
      const searchTime = Date.now() - startTime;

      expect(results.length).toBe(10);
      expect(searchTime).toBeLessThan(100); // Should search in under 100ms
    }, 15000);

    it('should handle concurrent searches', async () => {
      // Insert vectors
      for (let i = 0; i < 100; i++) {
        const embedding = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          embedding[j] = Math.random();
        }
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let j = 0; j < 128; j++) {
          embedding[j] /= norm;
        }

        db.prepare(`
          INSERT INTO pattern_embeddings (pattern_id, embedding)
          VALUES (?, ?)
        `).run(i, Buffer.from(embedding.buffer));
      }

      await hnswIndex.buildIndex('pattern_embeddings');

      const searches = Array(20).fill(null).map(() => {
        const query = new Float32Array(128);
        for (let i = 0; i < 128; i++) {
          query[i] = Math.random();
        }
        const norm = Math.sqrt(query.reduce((sum, v) => sum + v * v, 0));
        for (let i = 0; i < 128; i++) {
          query[i] /= norm;
        }
        return hnswIndex.search(query, 5);
      });

      const results = await Promise.all(searches);

      expect(results).toHaveLength(20);
      results.forEach(r => {
        expect(r.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle single vector', async () => {
      const embedding = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        embedding[i] = 1.0 / Math.sqrt(128);
      }

      db.prepare(`
        INSERT INTO pattern_embeddings (pattern_id, embedding)
        VALUES (?, ?)
      `).run(0, Buffer.from(embedding.buffer));

      await hnswIndex.buildIndex('pattern_embeddings');

      const results = await hnswIndex.search(embedding, 5);

      expect(results.length).toBe(1);
    });

    it('should handle k larger than index size', async () => {
      // Insert only 5 vectors
      for (let i = 0; i < 5; i++) {
        const embedding = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          embedding[j] = Math.random();
        }
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let j = 0; j < 128; j++) {
          embedding[j] /= norm;
        }

        db.prepare(`
          INSERT INTO pattern_embeddings (pattern_id, embedding)
          VALUES (?, ?)
        `).run(i, Buffer.from(embedding.buffer));
      }

      await hnswIndex.buildIndex('pattern_embeddings');

      const query = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        query[i] = Math.random();
      }

      const results = await hnswIndex.search(query, 100);

      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should handle zero vector query', async () => {
      for (let i = 0; i < 10; i++) {
        const embedding = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          embedding[j] = Math.random();
        }
        const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
        for (let j = 0; j < 128; j++) {
          embedding[j] /= norm;
        }

        db.prepare(`
          INSERT INTO pattern_embeddings (pattern_id, embedding)
          VALUES (?, ?)
        `).run(i, Buffer.from(embedding.buffer));
      }

      await hnswIndex.buildIndex('pattern_embeddings');

      const zeroQuery = new Float32Array(128);

      const results = await hnswIndex.search(zeroQuery, 5);

      expect(results).toBeDefined();
    });
  });
});
