/**
 * Enhanced EmbeddingService with WASM Acceleration
 *
 * Extends the base EmbeddingService with WASM-accelerated batch operations
 * and improved performance for large-scale embedding generation.
 */

import { EmbeddingService, EmbeddingConfig } from './EmbeddingService.js';
import { WASMVectorSearch } from './WASMVectorSearch.js';
import { cosineSimilarity } from '../utils/vector-math.js';
import { getEmbeddingConfig } from '../config/embedding-config.js';

export interface EnhancedEmbeddingConfig extends EmbeddingConfig {
  enableWASM?: boolean;
  enableBatchProcessing?: boolean;
  batchSize?: number;
}

export class EnhancedEmbeddingService extends EmbeddingService {
  private wasmSearch: WASMVectorSearch | null = null;
  private enhancedConfig: EnhancedEmbeddingConfig;

  // ADR-0161 follow-up: default config when called without args.
  // Upstream alpha.14 made config required, but the @sparkleideas/memory
  // controller-registry hydrates this controller with `new EES()` (no args)
  // because the registry has no embedding config to pass at hydration time.
  // Pre-ADR-0161 vendored EnhancedEmbeddingService accepted () via
  // constructor(config = {}) defaults. Restore that fork-side ergonomic so
  // alpha.14 can hydrate at registry-init without a Cannot-read-properties
  // error on first embed(). Defaults come from the project's centralized
  // getEmbeddingConfig() so they match init-template (model, dimension)
  // rather than diverging.
  constructor(config?: EnhancedEmbeddingConfig) {
    const baseDefaults = getEmbeddingConfig();
    const resolved: EnhancedEmbeddingConfig = {
      model: baseDefaults.model,
      dimension: baseDefaults.dimension,
      provider: 'transformers',
      enableWASM: true,
      enableBatchProcessing: true,
      batchSize: 100,
      ...(config ?? {}),
    };
    super(resolved);
    this.enhancedConfig = resolved;

    if (this.enhancedConfig.enableWASM) {
      this.initializeWASM();
    }
  }

  /**
   * Initialize WASM acceleration
   */
  private initializeWASM(): void {
    const mockDb = {
      prepare: () => ({ all: () => [], get: () => null, run: () => ({}) }),
      exec: () => {},
    };

    this.wasmSearch = new WASMVectorSearch(mockDb, {
      enableWASM: true,
      batchSize: this.enhancedConfig.batchSize || 100,
    });
  }

  /**
   * Enhanced batch embedding with parallel processing
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!this.enhancedConfig.enableBatchProcessing || texts.length < 10) {
      return super.embedBatch(texts);
    }

    const batchSize = this.enhancedConfig.batchSize || 100;
    const batches: string[][] = [];

    // Split into batches
    for (let i = 0; i < texts.length; i += batchSize) {
      batches.push(texts.slice(i, i + batchSize));
    }

    // Process batches in parallel
    const results = await Promise.all(
      batches.map(batch => super.embedBatch(batch))
    );

    // Flatten results
    return results.flat();
  }

  /**
   * Calculate similarity between two texts using WASM acceleration
   */
  async similarity(textA: string, textB: string): Promise<number> {
    const [embeddingA, embeddingB] = await Promise.all([
      this.embed(textA),
      this.embed(textB),
    ]);

    if (this.wasmSearch) {
      return this.wasmSearch.cosineSimilarity(embeddingA, embeddingB);
    }

    // Fallback to manual calculation
    return cosineSimilarity(embeddingA, embeddingB);
  }

  /**
   * Find most similar texts from a corpus
   */
  async findMostSimilar(
    query: string,
    corpus: string[],
    k: number = 5
  ): Promise<Array<{ text: string; similarity: number; index: number }>> {
    const queryEmbedding = await this.embed(query);
    const corpusEmbeddings = await this.embedBatch(corpus);

    let similarities: number[];

    if (this.wasmSearch) {
      similarities = this.wasmSearch.batchSimilarity(queryEmbedding, corpusEmbeddings);
    } else {
      similarities = corpusEmbeddings.map(emb =>
        cosineSimilarity(queryEmbedding, emb)
      );
    }

    // Create results with indices
    const results = corpus.map((text, index) => ({
      text,
      similarity: similarities[index],
      index,
    }));

    // Sort by similarity and take top k
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, k);
  }

  /**
   * Get service statistics
   */
  getStats(): {
    cacheSize: number;
    wasmEnabled: boolean;
    simdEnabled: boolean;
  } {
    const wasmStats = this.wasmSearch?.getStats();

    return {
      cacheSize: (this as any).cache.size,
      wasmEnabled: wasmStats?.wasmAvailable ?? false,
      simdEnabled: wasmStats?.simdAvailable ?? false,
    };
  }

}
