/**
 * HybridSearch Unit Tests
 *
 * Tests for KeywordIndex (BM25) and HybridSearch (combined vector + keyword)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  KeywordIndex,
  HybridSearch,
  createKeywordIndex,
  createHybridSearch,
} from '../../../src/search/HybridSearch.js';
import type { VectorBackend, SearchResult, VectorStats } from '../../../src/backends/VectorBackend.js';

// ============================================================================
// Mock VectorBackend
// ============================================================================

class MockVectorBackend implements VectorBackend {
  readonly name = 'hnswlib' as const;
  private vectors: Map<string, { embedding: Float32Array; metadata?: Record<string, any> }> = new Map();

  insert(id: string, embedding: Float32Array, metadata?: Record<string, any>): void {
    this.vectors.set(id, { embedding, metadata });
  }

  insertBatch(items: Array<{ id: string; embedding: Float32Array; metadata?: Record<string, any> }>): void {
    for (const item of items) {
      this.insert(item.id, item.embedding, item.metadata);
    }
  }

  search(query: Float32Array, k: number, options?: { threshold?: number; filter?: Record<string, any> }): SearchResult[] {
    const results: SearchResult[] = [];

    for (const [id, data] of this.vectors) {
      // Simple cosine similarity calculation
      const similarity = this.cosineSimilarity(query, data.embedding);

      // Apply filter
      if (options?.filter) {
        let matches = true;
        for (const [key, value] of Object.entries(options.filter)) {
          if (data.metadata?.[key] !== value) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
      }

      // Apply threshold
      if (options?.threshold !== undefined && similarity < options.threshold) {
        continue;
      }

      results.push({
        id,
        distance: 1 - similarity,
        similarity,
        metadata: data.metadata,
      });
    }

    // Sort by similarity (descending) and limit
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, k);
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  remove(id: string): boolean {
    return this.vectors.delete(id);
  }

  getStats(): VectorStats {
    const first = this.vectors.values().next().value;
    return {
      count: this.vectors.size,
      dimension: first?.embedding.length || 0,
      metric: 'cosine',
      backend: 'hnswlib',
      memoryUsage: 0,
    };
  }

  async save(_path: string): Promise<void> {}
  async load(_path: string): Promise<void> {}
  close(): void {}
}

// ============================================================================
// KeywordIndex Tests
// ============================================================================

describe('KeywordIndex', () => {
  let index: KeywordIndex;

  beforeEach(() => {
    index = new KeywordIndex();
  });

  describe('constructor', () => {
    it('should create with default BM25 config', () => {
      const stats = index.getStats();
      expect(stats.k1).toBe(1.2);
      expect(stats.b).toBe(0.75);
    });

    it('should create with custom BM25 config', () => {
      const customIndex = new KeywordIndex({ k1: 1.5, b: 0.8 });
      const stats = customIndex.getStats();
      expect(stats.k1).toBe(1.5);
      expect(stats.b).toBe(0.8);
    });

    it('should accept custom stopwords', () => {
      const customIndex = new KeywordIndex({}, ['custom', 'stop']);
      customIndex.add('doc1', 'custom stop words here');
      const results = customIndex.search('custom stop', 10);
      // Custom stopwords should be filtered out
      expect(results.length).toBe(0);
    });
  });

  describe('add', () => {
    it('should add documents to the index', () => {
      index.add('doc1', 'hello world');
      index.add('doc2', 'hello there');

      expect(index.size()).toBe(2);
      expect(index.has('doc1')).toBe(true);
      expect(index.has('doc2')).toBe(true);
    });

    it('should update existing documents', () => {
      index.add('doc1', 'hello world');
      index.add('doc1', 'goodbye world');

      expect(index.size()).toBe(1);

      const results = index.search('goodbye', 10);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('doc1');
    });

    it('should store metadata with documents', () => {
      index.add('doc1', 'machine learning tutorial', { category: 'tech' });

      const results = index.search('machine learning', 10);
      expect(results[0].metadata).toEqual({ category: 'tech' });
    });

    it('should handle empty text', () => {
      index.add('doc1', '');
      expect(index.size()).toBe(1);

      const results = index.search('anything', 10);
      expect(results.length).toBe(0);
    });

    it('should filter stopwords', () => {
      index.add('doc1', 'the quick brown fox');

      // 'the' is a stopword, so searching for it should return no results
      const results = index.search('the', 10);
      expect(results.length).toBe(0);
    });

    it('should filter short tokens', () => {
      index.add('doc1', 'a b c hello world');

      // Single character tokens should be filtered
      const results = index.search('a b c', 10);
      expect(results.length).toBe(0);
    });
  });

  describe('remove', () => {
    it('should remove documents from the index', () => {
      index.add('doc1', 'hello world');
      index.add('doc2', 'hello there');

      const removed = index.remove('doc1');

      expect(removed).toBe(true);
      expect(index.size()).toBe(1);
      expect(index.has('doc1')).toBe(false);
    });

    it('should return false for non-existent documents', () => {
      const removed = index.remove('nonexistent');
      expect(removed).toBe(false);
    });

    it('should clean up term entries when document is removed', () => {
      index.add('doc1', 'unique term here');

      expect(index.getDocumentFrequency('unique')).toBe(1);

      index.remove('doc1');

      expect(index.getDocumentFrequency('unique')).toBe(0);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      index.add('doc1', 'machine learning algorithms neural networks');
      index.add('doc2', 'deep learning neural networks tensorflow');
      index.add('doc3', 'natural language processing nlp bert');
      index.add('doc4', 'computer vision image recognition cnn');
    });

    it('should return relevant documents', () => {
      const results = index.search('neural networks', 10);

      expect(results.length).toBe(2);
      expect(results.map((r) => r.id)).toContain('doc1');
      expect(results.map((r) => r.id)).toContain('doc2');
    });

    it('should respect limit parameter', () => {
      const results = index.search('learning', 1);
      expect(results.length).toBe(1);
    });

    it('should return results sorted by score (descending)', () => {
      const results = index.search('neural networks learning', 10);

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('should return empty array for no matches', () => {
      const results = index.search('quantum computing', 10);
      expect(results.length).toBe(0);
    });

    it('should return empty array for empty query', () => {
      const results = index.search('', 10);
      expect(results.length).toBe(0);
    });

    it('should apply metadata filters', () => {
      index.add('doc5', 'machine learning models', { category: 'ml' });
      index.add('doc6', 'machine learning models', { category: 'other' });

      const results = index.search('machine learning', 10, { category: 'ml' });

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('doc5');
    });

    it('should handle single term queries', () => {
      const results = index.search('tensorflow', 10);

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('doc2');
    });
  });

  describe('BM25 scoring', () => {
    it('should give higher scores to documents with more term occurrences', () => {
      index.add('doc1', 'machine');
      index.add('doc2', 'machine machine machine');

      const results = index.search('machine', 10);

      expect(results.length).toBe(2);
      // doc2 has more occurrences, should score higher
      expect(results[0].id).toBe('doc2');
    });

    it('should handle IDF correctly (rare terms more valuable)', () => {
      index.add('doc1', 'common rare');
      index.add('doc2', 'common');
      index.add('doc3', 'common');
      index.add('doc4', 'common');

      const results = index.search('rare', 10);

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('doc1');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      index.add('doc1', 'hello world');
      index.add('doc2', 'hello goodbye friend');

      const stats = index.getStats();

      expect(stats.documentCount).toBe(2);
      // Unique terms after stopword removal: hello, world, goodbye, friend = 4 unique terms
      expect(stats.termCount).toBe(4);
      expect(stats.avgDocumentLength).toBe(2.5); // (2 + 3) / 2
    });
  });

  describe('clear', () => {
    it('should remove all documents', () => {
      index.add('doc1', 'hello world');
      index.add('doc2', 'hello there');

      index.clear();

      expect(index.size()).toBe(0);
      expect(index.has('doc1')).toBe(false);
    });
  });

  describe('stopword management', () => {
    it('should allow adding stopwords', () => {
      index.addStopwords(['custom']);
      index.add('doc1', 'custom term here');

      const results = index.search('custom', 10);
      expect(results.length).toBe(0);
    });

    it('should allow removing stopwords', () => {
      index.removeStopwords(['the']);
      index.add('doc1', 'the cat');

      const results = index.search('the', 10);
      expect(results.length).toBe(1);
    });
  });

  describe('setConfig', () => {
    it('should update BM25 parameters', () => {
      index.setConfig({ k1: 2.0, b: 0.5 });
      const stats = index.getStats();

      expect(stats.k1).toBe(2.0);
      expect(stats.b).toBe(0.5);
    });
  });
});

// ============================================================================
// HybridSearch Tests
// ============================================================================

describe('HybridSearch', () => {
  let vectorBackend: MockVectorBackend;
  let keywordIndex: KeywordIndex;
  let hybridSearch: HybridSearch;

  // Helper to create test vectors
  const createVector = (values: number[]): Float32Array => new Float32Array(values);

  beforeEach(() => {
    vectorBackend = new MockVectorBackend();
    keywordIndex = new KeywordIndex();

    // Add test data
    const testDocs = [
      { id: 'doc1', text: 'machine learning algorithms', vector: [1, 0, 0, 0] },
      { id: 'doc2', text: 'deep learning neural networks', vector: [0.9, 0.1, 0, 0] },
      { id: 'doc3', text: 'natural language processing', vector: [0, 1, 0, 0] },
      { id: 'doc4', text: 'computer vision recognition', vector: [0, 0, 1, 0] },
      { id: 'doc5', text: 'data science analytics', vector: [0.5, 0.5, 0, 0] },
    ];

    for (const doc of testDocs) {
      vectorBackend.insert(doc.id, createVector(doc.vector));
      keywordIndex.add(doc.id, doc.text);
    }

    hybridSearch = new HybridSearch(vectorBackend, keywordIndex);
  });

  describe('constructor', () => {
    it('should create HybridSearch with backends', () => {
      expect(hybridSearch).toBeDefined();
      expect(hybridSearch.getVectorBackend()).toBe(vectorBackend);
      expect(hybridSearch.getKeywordIndex()).toBe(keywordIndex);
    });
  });

  describe('search - vector only', () => {
    it('should perform vector-only search when no text provided', async () => {
      const results = await hybridSearch.search(
        { vector: createVector([1, 0, 0, 0]) },
        { limit: 3 }
      );

      expect(results.length).toBe(3);
      expect(results[0].id).toBe('doc1'); // Exact match
      expect(results[0].source).toBe('vector');
      expect(results[0].vectorScore).toBeDefined();
      expect(results[0].keywordScore).toBeUndefined();
    });

    it('should apply threshold to vector results', async () => {
      const results = await hybridSearch.search(
        { vector: createVector([1, 0, 0, 0]) },
        { limit: 10, threshold: 0.9 }
      );

      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0.9);
      }
    });
  });

  describe('search - keyword only', () => {
    it('should perform keyword-only search when no vector provided', async () => {
      const results = await hybridSearch.search(
        { text: 'machine learning' },
        { limit: 3 }
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].source).toBe('keyword');
      expect(results[0].keywordScore).toBeDefined();
      expect(results[0].vectorScore).toBeUndefined();
    });

    it('should normalize keyword scores to 0-1', async () => {
      const results = await hybridSearch.search(
        { text: 'machine learning' },
        { limit: 10 }
      );

      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('search - hybrid with RRF', () => {
    it('should combine vector and keyword results using RRF', async () => {
      const results = await hybridSearch.search(
        {
          text: 'machine learning',
          vector: createVector([1, 0, 0, 0]),
        },
        {
          limit: 5,
          fusionMethod: 'rrf',
          vectorWeight: 0.7,
          keywordWeight: 0.3,
        }
      );

      expect(results.length).toBeGreaterThan(0);

      // doc1 should rank high (matches both)
      const doc1 = results.find((r) => r.id === 'doc1');
      expect(doc1).toBeDefined();
      expect(doc1?.source).toBe('both');
    });

    it('should mark source as "both" when result appears in both', async () => {
      const results = await hybridSearch.search(
        {
          text: 'learning',
          vector: createVector([1, 0, 0, 0]),
        },
        { limit: 10, fusionMethod: 'rrf' }
      );

      const bothResults = results.filter((r) => r.source === 'both');
      expect(bothResults.length).toBeGreaterThan(0);
    });

    it('should normalize RRF scores to 0-1', async () => {
      const results = await hybridSearch.search(
        {
          text: 'learning',
          vector: createVector([1, 0, 0, 0]),
        },
        { limit: 10, fusionMethod: 'rrf' }
      );

      expect(results[0].score).toBe(1); // Top result normalized to 1
      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('search - hybrid with linear fusion', () => {
    it('should combine results using weighted linear combination', async () => {
      const results = await hybridSearch.search(
        {
          text: 'machine learning',
          vector: createVector([1, 0, 0, 0]),
        },
        {
          limit: 5,
          fusionMethod: 'linear',
          vectorWeight: 0.5,
          keywordWeight: 0.5,
        }
      );

      expect(results.length).toBeGreaterThan(0);

      // Check that scores are properly combined
      for (const result of results) {
        if (result.source === 'both') {
          // Combined score should reflect both sources
          expect(result.vectorScore).toBeDefined();
          expect(result.keywordScore).toBeDefined();
        }
      }
    });
  });

  describe('search - hybrid with max fusion', () => {
    it('should take maximum score from either source', async () => {
      const results = await hybridSearch.search(
        {
          text: 'machine learning',
          vector: createVector([1, 0, 0, 0]),
        },
        {
          limit: 5,
          fusionMethod: 'max',
        }
      );

      expect(results.length).toBeGreaterThan(0);

      // Check max fusion logic
      for (const result of results) {
        if (result.source === 'both') {
          const maxScore = Math.max(result.vectorScore || 0, result.keywordScore || 0);
          expect(result.score).toBeCloseTo(maxScore, 5);
        }
      }
    });
  });

  describe('weight configuration', () => {
    it('should normalize weights to sum to 1', async () => {
      const results1 = await hybridSearch.search(
        { text: 'learning', vector: createVector([1, 0, 0, 0]) },
        { limit: 5, vectorWeight: 1, keywordWeight: 1, fusionMethod: 'linear' }
      );

      const results2 = await hybridSearch.search(
        { text: 'learning', vector: createVector([1, 0, 0, 0]) },
        { limit: 5, vectorWeight: 0.5, keywordWeight: 0.5, fusionMethod: 'linear' }
      );

      // Results should be the same (weights normalized to 0.5 each)
      expect(results1.map((r) => r.id)).toEqual(results2.map((r) => r.id));
    });

    it('should reject negative weights', async () => {
      await expect(
        hybridSearch.search(
          { text: 'learning' },
          { limit: 5, vectorWeight: -0.5 }
        )
      ).rejects.toThrow('Weights must be non-negative');
    });
  });

  describe('filtering', () => {
    it('should apply metadata filter to results', async () => {
      // Add documents with metadata
      vectorBackend.insert('filtered1', createVector([0.8, 0.2, 0, 0]), { category: 'ml' });
      vectorBackend.insert('filtered2', createVector([0.8, 0.2, 0, 0]), { category: 'other' });
      keywordIndex.add('filtered1', 'filtered document ml', { category: 'ml' });
      keywordIndex.add('filtered2', 'filtered document other', { category: 'other' });

      const results = await hybridSearch.search(
        { vector: createVector([0.8, 0.2, 0, 0]) },
        { limit: 10, filter: { category: 'ml' } }
      );

      const filteredIds = results.map((r) => r.id);
      expect(filteredIds).toContain('filtered1');
      expect(filteredIds).not.toContain('filtered2');
    });
  });

  describe('getStats', () => {
    it('should return combined statistics', () => {
      const stats = hybridSearch.getStats();

      expect(stats.vector).toBeDefined();
      expect(stats.vector.count).toBe(5);
      expect(stats.vector.backend).toBe('hnswlib');

      expect(stats.keyword).toBeDefined();
      expect(stats.keyword.documentCount).toBe(5);
      expect(stats.keyword.termCount).toBeGreaterThan(0);
    });
  });

  describe('document management', () => {
    it('should add documents via convenience method', () => {
      hybridSearch.addDocument('new1', 'new document content', { type: 'new' });

      const stats = hybridSearch.getStats();
      expect(stats.keyword.documentCount).toBe(6);
    });

    it('should remove documents via convenience method', () => {
      const removed = hybridSearch.removeDocument('doc1');

      expect(removed).toBe(true);
      const stats = hybridSearch.getStats();
      expect(stats.keyword.documentCount).toBe(4);
    });
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('Factory Functions', () => {
  describe('createKeywordIndex', () => {
    it('should create KeywordIndex with defaults', () => {
      const index = createKeywordIndex();
      expect(index).toBeInstanceOf(KeywordIndex);
    });

    it('should create KeywordIndex with custom config', () => {
      const index = createKeywordIndex({ k1: 2.0, b: 0.5 });
      const stats = index.getStats();
      expect(stats.k1).toBe(2.0);
      expect(stats.b).toBe(0.5);
    });

    it('should create KeywordIndex with custom stopwords', () => {
      const index = createKeywordIndex({}, ['customstop']);
      index.add('doc1', 'customstop word here');
      const results = index.search('customstop', 10);
      expect(results.length).toBe(0);
    });
  });

  describe('createHybridSearch', () => {
    it('should create HybridSearch with provided backends', () => {
      const vectorBackend = new MockVectorBackend();
      const keywordIndex = new KeywordIndex();

      const hybrid = createHybridSearch(vectorBackend, keywordIndex);

      expect(hybrid).toBeInstanceOf(HybridSearch);
      expect(hybrid.getVectorBackend()).toBe(vectorBackend);
      expect(hybrid.getKeywordIndex()).toBe(keywordIndex);
    });

    it('should create HybridSearch with new KeywordIndex if not provided', () => {
      const vectorBackend = new MockVectorBackend();

      const hybrid = createHybridSearch(vectorBackend);

      expect(hybrid).toBeInstanceOf(HybridSearch);
      expect(hybrid.getKeywordIndex()).toBeInstanceOf(KeywordIndex);
    });
  });
});
