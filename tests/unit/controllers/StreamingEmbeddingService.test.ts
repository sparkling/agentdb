/**
 * Unit Tests for StreamingEmbeddingService
 *
 * Tests incremental / streaming embedding generation built on top of
 * EnhancedEmbeddingService:
 *   - streamEmbed (chunk-by-chunk) + progress callbacks
 *   - streamEmbedBatch (batched) + progress callbacks
 *   - streamSimilarity (incremental scoring)
 *   - streamFindMostSimilar (streaming top-k)
 *   - stream lifecycle (cancelStream / cancelAllStreams / getStreamingStats)
 *   - chunk splitting on sentence boundaries
 *
 * Uses provider 'local' → deterministic mock embeddings (no model download,
 * no network). WASM disabled to keep the unit under test pure. A small
 * chunkSize forces multi-chunk streaming so behavior is observable.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  StreamingEmbeddingService,
  StreamProgress,
} from '../../../src/controllers/StreamingEmbeddingService.js';

function makeService(overrides: Record<string, unknown> = {}): StreamingEmbeddingService {
  return new StreamingEmbeddingService({
    model: 'mock-model',
    dimension: 384,
    provider: 'local',
    enableWASM: false,
    chunkSize: 30,
    ...overrides,
  });
}

describe('StreamingEmbeddingService', () => {
  let service: StreamingEmbeddingService;

  beforeEach(() => {
    service = makeService();
  });

  describe('construction & configuration', () => {
    it('should construct with explicit config', () => {
      expect(service).toBeInstanceOf(StreamingEmbeddingService);
    });

    it('should expose streaming configuration via getStreamingStats', () => {
      const stats = service.getStreamingStats();
      expect(stats.chunkSize).toBe(30);
      expect(stats.maxConcurrentChunks).toBe(4); // default
      expect(stats.progressCallbacksEnabled).toBe(true); // default
      expect(stats.activeStreams).toBe(0);
    });

    it('should honor custom maxConcurrentChunks and progress-callback toggle', () => {
      const custom = makeService({ maxConcurrentChunks: 2, enableProgressCallbacks: false });
      const stats = custom.getStreamingStats();
      expect(stats.maxConcurrentChunks).toBe(2);
      expect(stats.progressCallbacksEnabled).toBe(false);
    });
  });

  describe('streamEmbed', () => {
    const MULTI = 'First sentence here. Second sentence follows. Third one too. Fourth and final sentence.';

    it('should yield one embedding per chunk', async () => {
      const out: Float32Array[] = [];
      for await (const emb of service.streamEmbed(MULTI)) {
        out.push(emb);
      }
      // 4 sentences, chunkSize 30 → each sentence is its own chunk.
      expect(out.length).toBe(4);
    });

    it('should yield embeddings of the configured dimension', async () => {
      for await (const emb of service.streamEmbed(MULTI)) {
        expect(emb).toBeInstanceOf(Float32Array);
        expect(emb.length).toBe(384);
      }
    });

    it('should report monotonically increasing progress ending at 100', async () => {
      const progresses: StreamProgress[] = [];
      const out: Float32Array[] = [];
      for await (const emb of service.streamEmbed(MULTI, p => progresses.push({ ...p }))) {
        out.push(emb);
      }

      expect(progresses.length).toBe(out.length);
      // Monotonic non-decreasing processedChunks.
      for (let i = 1; i < progresses.length; i++) {
        expect(progresses[i].processedChunks).toBeGreaterThanOrEqual(progresses[i - 1].processedChunks);
      }
      const last = progresses[progresses.length - 1];
      expect(last.progress).toBe(100);
      expect(last.processedChunks).toBe(last.totalChunks);
    });

    it('should not invoke progress callbacks when disabled', async () => {
      const noCb = makeService({ enableProgressCallbacks: false });
      let called = 0;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _emb of noCb.streamEmbed(MULTI, () => { called++; })) {
        // drain
      }
      expect(called).toBe(0);
    });

    it('should treat a short single-sentence text as one chunk', async () => {
      const out: Float32Array[] = [];
      for await (const emb of service.streamEmbed('Just one short bit.')) {
        out.push(emb);
      }
      expect(out.length).toBe(1);
    });

    it('should handle text with no sentence terminators as a single chunk', async () => {
      const out: Float32Array[] = [];
      for await (const emb of service.streamEmbed('no terminator here just words')) {
        out.push(emb);
      }
      expect(out.length).toBe(1);
    });

    it('should leave no active streams after completion', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _emb of service.streamEmbed(MULTI)) {
        // drain
      }
      expect(service.getStreamingStats().activeStreams).toBe(0);
    });
  });

  describe('streamEmbedBatch', () => {
    it('should yield embeddings for every input text across batches', async () => {
      const svc = makeService({ batchSize: 3 });
      const texts = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
      const collected: Float32Array[] = [];

      for await (const batch of svc.streamEmbedBatch(texts)) {
        expect(Array.isArray(batch)).toBe(true);
        collected.push(...batch);
      }

      expect(collected.length).toBe(texts.length);
      collected.forEach(e => expect(e.length).toBe(384));
    });

    it('should split into the expected number of batches', async () => {
      const svc = makeService({ batchSize: 2 });
      const texts = ['a', 'b', 'c', 'd', 'e']; // 5 / 2 → 3 batches
      let batchCount = 0;

      for await (const batch of svc.streamEmbedBatch(texts)) {
        batchCount++;
        expect(batch.length).toBeGreaterThan(0);
      }
      expect(batchCount).toBe(3);
    });

    it('should report progress reaching 100% across batches', async () => {
      const svc = makeService({ batchSize: 2 });
      const texts = ['a', 'b', 'c', 'd'];
      const progresses: StreamProgress[] = [];

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _b of svc.streamEmbedBatch(texts, p => progresses.push({ ...p }))) {
        // drain
      }

      const last = progresses[progresses.length - 1];
      expect(last.progress).toBe(100);
      expect(last.processedChunks).toBe(texts.length);
    });

    it('should yield nothing for an empty input array', async () => {
      let batchCount = 0;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _b of service.streamEmbedBatch([])) {
        batchCount++;
      }
      expect(batchCount).toBe(0);
    });
  });

  describe('streamSimilarity', () => {
    it('should yield a scored result for each corpus entry', async () => {
      const corpus = ['alpha text', 'beta text', 'gamma text', 'delta text'];
      const results: Array<{ text: string; similarity: number; index: number }> = [];

      for await (const r of service.streamSimilarity('query text', corpus)) {
        results.push(r);
      }

      expect(results.length).toBe(corpus.length);
      results.forEach(r => {
        expect(corpus).toContain(r.text);
        expect(typeof r.similarity).toBe('number');
        expect(r.similarity).toBeGreaterThanOrEqual(-1.0001);
        expect(r.similarity).toBeLessThanOrEqual(1.0001);
      });
    });

    it('should align text/index/similarity correctly', async () => {
      const corpus = ['one', 'two', 'three'];
      const results: Array<{ text: string; similarity: number; index: number }> = [];
      for await (const r of service.streamSimilarity('q', corpus)) {
        results.push(r);
      }
      // Every emitted result's text must match the corpus at its index.
      results.forEach(r => expect(corpus[r.index]).toBe(r.text));
      // Indices cover the full corpus exactly once.
      expect(results.map(r => r.index).sort()).toEqual([0, 1, 2]);
    });

    it('should report similarity 1.0 for an identical corpus entry', async () => {
      const corpus = ['exact match phrase', 'unrelated other phrase'];
      const results: Record<string, number> = {};
      for await (const r of service.streamSimilarity('exact match phrase', corpus)) {
        results[r.text] = r.similarity;
      }
      // Mock embeddings are deterministic per text → identical text ⇒ cos = 1.
      expect(results['exact match phrase']).toBeCloseTo(1.0, 5);
    });
  });

  describe('streamFindMostSimilar', () => {
    it('should stream results and never exceed sensible bounds', async () => {
      const corpus = ['apple pie', 'banana bread', 'cherry tart', 'date cake', 'elderberry jam'];
      const emitted: Array<{ text: string; similarity: number; index: number }> = [];

      for await (const r of service.streamFindMostSimilar('apple pie', corpus, 3)) {
        emitted.push(r);
        expect(corpus).toContain(r.text);
      }

      // At least one result is emitted; the exact-match query is among them.
      expect(emitted.length).toBeGreaterThan(0);
      expect(emitted.some(r => r.text === 'apple pie')).toBe(true);
    });

    it('should surface the exact match with similarity 1.0', async () => {
      const corpus = ['needle in haystack', 'completely different', 'another thing'];
      let bestForNeedle = -Infinity;
      for await (const r of service.streamFindMostSimilar('needle in haystack', corpus, 2)) {
        if (r.text === 'needle in haystack') bestForNeedle = r.similarity;
      }
      expect(bestForNeedle).toBeCloseTo(1.0, 5);
    });

    it('should handle k larger than the corpus size', async () => {
      const corpus = ['only', 'two'];
      const emitted: string[] = [];
      for await (const r of service.streamFindMostSimilar('only', corpus, 10)) {
        emitted.push(r.text);
      }
      // Cannot emit more distinct results than the corpus holds.
      expect(new Set(emitted).size).toBeLessThanOrEqual(corpus.length);
      expect(emitted.length).toBeGreaterThan(0);
    });
  });

  describe('stream lifecycle', () => {
    it('cancelStream should return false for an unknown stream id', () => {
      expect(service.cancelStream('no-such-stream')).toBe(false);
    });

    it('cancelAllStreams should return 0 when no streams are active', () => {
      expect(service.cancelAllStreams()).toBe(0);
    });

    it('getStreamingStats.activeStreams should be 0 at rest', () => {
      expect(service.getStreamingStats().activeStreams).toBe(0);
    });

    it('should fully drain active streams (finally cleanup) after iteration', async () => {
      const gen = service.streamEmbed('Sentence one. Sentence two. Sentence three.');
      // Pull a single value, then complete the generator via return().
      const first = await gen.next();
      expect(first.done).toBe(false);
      // Early-terminate the generator — triggers the finally cleanup branch.
      await gen.return?.(undefined as any);
      expect(service.getStreamingStats().activeStreams).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle Unicode text in streamEmbed', async () => {
      const out: Float32Array[] = [];
      for await (const emb of service.streamEmbed('部署清单 🚀. 第二句 🔐.')) {
        out.push(emb);
      }
      expect(out.length).toBeGreaterThan(0);
      out.forEach(e => expect(e.length).toBe(384));
    });

    it('should handle an empty corpus in streamSimilarity', async () => {
      let count = 0;
      for await (const _r of service.streamSimilarity('query', [])) {
        count++;
      }
      expect(count).toBe(0);
    });
  });
});
