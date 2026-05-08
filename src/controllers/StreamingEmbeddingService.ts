/**
 * Streaming Embedding Service - Incremental Embedding Generation
 *
 * ADR-065 Phase P1-3: Streaming Architecture
 *
 * Extends EnhancedEmbeddingService with streaming capabilities:
 * - Incremental embedding generation (chunk-by-chunk)
 * - Real-time progress callbacks
 * - Memory-efficient processing for large texts
 * - Parallel chunk processing with backpressure
 */

import { EnhancedEmbeddingService, EnhancedEmbeddingConfig } from './EnhancedEmbeddingService.js';
import { getEmbeddingConfig } from '../config/embedding-config.js';

export interface StreamingConfig extends EnhancedEmbeddingConfig {
  chunkSize?: number;
  maxConcurrentChunks?: number;
  enableProgressCallbacks?: boolean;
}

export interface StreamProgress {
  processedChunks: number;
  totalChunks: number;
  progress: number; // 0-100
  currentChunk: string;
  estimatedTimeMs: number;
}

export type ProgressCallback = (progress: StreamProgress) => void;

/**
 * Streaming Embedding Service with incremental generation
 */
export class StreamingEmbeddingService extends EnhancedEmbeddingService {
  private streamingConfig: Required<StreamingConfig> & { apiKey: string };
  private activeStreams = new Map<string, AbortController>();

  constructor(config: Partial<StreamingConfig> = {}) {
    const embCfg = getEmbeddingConfig();
    super({ model: embCfg.model, dimension: embCfg.dimension, provider: embCfg.provider, ...config } as StreamingConfig);
    this.streamingConfig = {
      ...config,
      model: config.model || embCfg.model,
      dimension: config.dimension || embCfg.dimension,
      provider: config.provider || 'transformers',
      enableWASM: config.enableWASM ?? true,
      enableBatchProcessing: config.enableBatchProcessing ?? true,
      batchSize: config.batchSize || 100,
      chunkSize: config.chunkSize || 512,
      maxConcurrentChunks: config.maxConcurrentChunks || 4,
      enableProgressCallbacks: config.enableProgressCallbacks ?? true,
      apiKey: config.apiKey || ''
    };
  }

  /**
   * Stream embedding generation for large text
   * Yields partial embeddings as they're computed
   */
  async *streamEmbed(
    text: string,
    onProgress?: ProgressCallback
  ): AsyncGenerator<Float32Array> {
    const streamId = this.generateStreamId();
    const controller = new AbortController();
    this.activeStreams.set(streamId, controller);

    try {
      const chunks = this.splitIntoChunks(text);
      const startTime = Date.now();
      let processedChunks = 0;

      // Process chunks in parallel batches
    const maxConcurrent = this.streamingConfig.maxConcurrentChunks;
      for (let i = 0; i < chunks.length; i += maxConcurrent) {
        if (controller.signal.aborted) {
          break;
        }

        const batchChunks = chunks.slice(i, i + maxConcurrent);
        const embeddings = await this.processBatchChunks(batchChunks);

        for (const embedding of embeddings) {
          processedChunks++;

          // Report progress
          if (onProgress && this.streamingConfig.enableProgressCallbacks) {
            const elapsed = Date.now() - startTime;
            const avgTimePerChunk = elapsed / processedChunks;
            const remaining = chunks.length - processedChunks;

            onProgress({
              processedChunks,
              totalChunks: chunks.length,
              progress: (processedChunks / chunks.length) * 100,
              currentChunk: batchChunks[embeddings.indexOf(embedding)]?.substring(0, 50) || '',
              estimatedTimeMs: avgTimePerChunk * remaining,
            });
          }

          yield embedding;
        }
      }
    } finally {
      this.activeStreams.delete(streamId);
    }
  }

  /**
   * Stream batch embeddings with memory-efficient processing
   */
  async *streamEmbedBatch(
    texts: string[],
    onProgress?: ProgressCallback
  ): AsyncGenerator<Float32Array[]> {
    const streamId = this.generateStreamId();
    const controller = new AbortController();
    this.activeStreams.set(streamId, controller);

    try {
      const batchSize = this.streamingConfig.batchSize;
      let processedBatches = 0;
      const totalBatches = Math.ceil(texts.length / batchSize);
      const startTime = Date.now();

      for (let i = 0; i < texts.length; i += batchSize) {
        if (controller.signal.aborted) {
          break;
        }

        const batch = texts.slice(i, i + batchSize);
        const embeddings = await super.embedBatch(batch);
        processedBatches++;

        // Report progress
        if (onProgress && this.streamingConfig.enableProgressCallbacks) {
          const elapsed = Date.now() - startTime;
          const avgTimePerBatch = elapsed / processedBatches;
          const remaining = totalBatches - processedBatches;

          onProgress({
            processedChunks: i + batch.length,
            totalChunks: texts.length,
            progress: ((i + batch.length) / texts.length) * 100,
            currentChunk: `Batch ${processedBatches}/${totalBatches}`,
            estimatedTimeMs: avgTimePerBatch * remaining,
          });
        }

        yield embeddings;
      }
    } finally {
      this.activeStreams.delete(streamId);
    }
  }

  /**
   * Incremental similarity calculation
   * Streams similarity scores as embeddings are computed
   */
  async *streamSimilarity(
    queryText: string,
    corpusTexts: string[],
    onProgress?: ProgressCallback
  ): AsyncGenerator<{ text: string; similarity: number; index: number }> {
    const queryEmbedding = await this.embed(queryText);
    let processed = 0;
    const startTime = Date.now();

    // Stream similarity scores as embeddings are computed
    for await (const embeddings of this.streamEmbedBatch(corpusTexts, onProgress)) {
      for (let i = 0; i < embeddings.length; i++) {
        const corpusEmbedding = embeddings[i];
        const similarity = this.calculateSimilarity(queryEmbedding, corpusEmbedding);
        const index = processed + i;

        yield {
          text: corpusTexts[index],
          similarity,
          index,
        };
      }
      processed += embeddings.length;
    }
  }

  /**
   * Find most similar texts with streaming results
   * Returns results in real-time as they're computed
   */
  async *streamFindMostSimilar(
    query: string,
    corpus: string[],
    k: number = 5,
    onProgress?: ProgressCallback
  ): AsyncGenerator<{ text: string; similarity: number; index: number }> {
    const results: Array<{ text: string; similarity: number; index: number }> = [];
    let minSimilarity = -Infinity;

    // Stream similarity calculations
    for await (const result of this.streamSimilarity(query, corpus, onProgress)) {
      // Maintain top-k results
      if (results.length < k) {
        results.push(result);
        results.sort((a, b) => b.similarity - a.similarity);
        minSimilarity = results[results.length - 1].similarity;
      } else if (result.similarity > minSimilarity) {
        results.push(result);
        results.sort((a, b) => b.similarity - a.similarity);
        results.pop();
        minSimilarity = results[results.length - 1].similarity;
      }

      // Yield current top result if it's new
      if (results[0] === result || result.similarity > minSimilarity) {
        yield result;
      }
    }
  }

  /**
   * Cancel active stream
   */
  cancelStream(streamId: string): boolean {
    const controller = this.activeStreams.get(streamId);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(streamId);
      return true;
    }
    return false;
  }

  /**
   * Cancel all active streams
   */
  cancelAllStreams(): number {
    const count = this.activeStreams.size;
    for (const controller of this.activeStreams.values()) {
      controller.abort();
    }
    this.activeStreams.clear();
    return count;
  }

  /**
   * Get streaming statistics
   */
  getStreamingStats(): {
    activeStreams: number;
    chunkSize: number;
    maxConcurrentChunks: number;
    progressCallbacksEnabled: boolean;
  } {
    return {
      activeStreams: this.activeStreams.size,
      chunkSize: this.streamingConfig.chunkSize,
      maxConcurrentChunks: this.streamingConfig.maxConcurrentChunks,
      progressCallbacksEnabled: this.streamingConfig.enableProgressCallbacks,
    };
  }

  // -- Private Helpers ------------------------------------------------------

  private splitIntoChunks(text: string): string[] {
    const chunks: string[] = [];

    // Split on sentence boundaries when possible
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let currentChunk = '';

    for (const sentence of sentences) {
    const chunkSize = this.streamingConfig.chunkSize;
      if (currentChunk.length + sentence.length > chunkSize) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = sentence;
      } else {
        currentChunk += ' ' + sentence;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  private async processBatchChunks(chunks: string[]): Promise<Float32Array[]> {
    return await super.embedBatch(chunks);
  }

  private calculateSimilarity(a: Float32Array, b: Float32Array): number {
    // Cosine similarity
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private generateStreamId(): string {
    return `stream_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}
