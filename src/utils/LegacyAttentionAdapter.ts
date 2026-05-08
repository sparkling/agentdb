/**
 * LegacyAttentionAdapter - Compatibility layer for deprecated services/AttentionService
 *
 * This module re-exports the legacy config types and provides a backward-compatible
 * AttentionService class that delegates to the production controllers/AttentionService.
 *
 * Created as part of ADR-056: consolidation of services/AttentionService into controllers.
 *
 * @module LegacyAttentionAdapter
 */

import { AttentionService as ControllersAttentionService } from '../controllers/AttentionService.js';
import type { AttentionResult } from '../controllers/AttentionService.js';
import { getEmbeddingConfig } from '../config/embedding-config.js';

// Database type placeholder (matches legacy pattern)
type Database = any;

// ========================================================================
// Legacy Config Types (previously in services/AttentionService.ts)
// ========================================================================

export interface HyperbolicAttentionConfig {
  enabled: boolean;
  curvature?: number;
  dimension?: number;
  temperature?: number;
}

export interface FlashAttentionConfig {
  enabled: boolean;
  blockSize?: number;
  useSIMD?: boolean;
  maxSeqLen?: number;
}

export interface GraphRoPEConfig {
  enabled: boolean;
  maxHops?: number;
  rotaryDim?: number;
  baseFreq?: number;
}

export interface MoEAttentionConfig {
  enabled: boolean;
  numExperts?: number;
  topK?: number;
  expertDomains?: string[];
}

// Legacy result types
export interface HyperbolicAttentionResult {
  attended: Float32Array;
  weights: Float32Array;
  distances: number[];
  metrics: {
    computeTimeMs: number;
    memoryUsedMB: number;
  };
}

export interface FlashAttentionResult {
  output: Float32Array;
  scores?: Float32Array;
  metrics: {
    computeTimeMs: number;
    peakMemoryMB: number;
    blocksProcessed: number;
  };
}

export interface GraphRoPEResult {
  queries: Float32Array;
  keys: Float32Array;
  hopEncodings: Float32Array;
  metrics: {
    computeTimeMs: number;
  };
}

// ========================================================================
// Legacy AttentionService Adapter
// ========================================================================

/**
 * Backward-compatible AttentionService that delegates to the production
 * controllers/AttentionService while maintaining the legacy constructor
 * and method signatures used by ExplainableRecall, NightlyLearner, and
 * CausalMemoryGraph.
 */
export class AttentionService {
  private delegate: ControllersAttentionService;
  private hyperbolicConfig: HyperbolicAttentionConfig;
  private flashConfig: FlashAttentionConfig;
  private graphRoPEConfig: GraphRoPEConfig;

  constructor(
    _db: Database,
    configs?: {
      hyperbolic?: Partial<HyperbolicAttentionConfig>;
      flash?: Partial<FlashAttentionConfig>;
      graphRoPE?: Partial<GraphRoPEConfig>;
      moe?: Partial<MoEAttentionConfig>;
    }
  ) {
    this.hyperbolicConfig = {
      enabled: false,
      curvature: 1.0,
      dimension: getEmbeddingConfig().dimension,
      temperature: 1.0,
      ...configs?.hyperbolic,
    };

    this.flashConfig = {
      enabled: false,
      blockSize: 256,
      useSIMD: true,
      maxSeqLen: 4096,
      ...configs?.flash,
    };

    this.graphRoPEConfig = {
      enabled: false,
      maxHops: 10,
      rotaryDim: 64,
      baseFreq: 10000,
      ...configs?.graphRoPE,
    };

    const dim = this.hyperbolicConfig.dimension ?? getEmbeddingConfig().dimension;
    this.delegate = new ControllersAttentionService({
      numHeads: 1,
      headDim: dim,
      embedDim: dim,
      useFlash: this.flashConfig.enabled,
      useHyperbolic: this.hyperbolicConfig.enabled,
    });
  }

  async hyperbolicAttention(
    queries: Float32Array,
    keys: Float32Array,
    values: Float32Array,
    hierarchyLevels: number[]
  ): Promise<HyperbolicAttentionResult> {
    const startTime = Date.now();
    const dim = this.hyperbolicConfig.dimension ?? getEmbeddingConfig().dimension;
    const numKeys = keys.length / dim;

    try {
      const result: AttentionResult = await this.delegate.hyperbolicAttention(
        queries,
        keys,
        values,
        this.hyperbolicConfig.curvature ?? 1.0
      );

      const weights = result.weights ?? new Float32Array(numKeys);
      const distances = hierarchyLevels.slice(0, numKeys);

      return {
        attended: result.output,
        weights,
        distances,
        metrics: {
          computeTimeMs: result.executionTimeMs ?? (Date.now() - startTime),
          memoryUsedMB: (result.output.byteLength + weights.byteLength) / (1024 * 1024),
        },
      };
    } catch {
      // Fallback: simple hierarchical attention
      return this.fallbackHyperbolicAttention(queries, keys, values, hierarchyLevels, startTime);
    }
  }

  async flashAttention(
    queries: Float32Array,
    keys: Float32Array,
    values: Float32Array
  ): Promise<FlashAttentionResult> {
    const startTime = Date.now();

    try {
      const result: AttentionResult = await this.delegate.flashAttention(
        queries,
        keys,
        values
      );

      return {
        output: result.output,
        metrics: {
          computeTimeMs: result.executionTimeMs ?? (Date.now() - startTime),
          peakMemoryMB: result.output.byteLength / (1024 * 1024),
          blocksProcessed: 1,
        },
      };
    } catch {
      // Fallback: chunked attention
      return this.fallbackFlashAttention(queries, keys, values, startTime);
    }
  }

  async graphRoPE(
    queries: Float32Array,
    keys: Float32Array,
    hopDistances: number[][]
  ): Promise<GraphRoPEResult> {
    const startTime = Date.now();
    // GraphRoPE is not in the controllers version; use fallback
    return this.fallbackGraphRoPE(queries, keys, hopDistances, startTime);
  }

  // ========================================================================
  // Fallback implementations (preserved from deprecated services version)
  // ========================================================================

  private fallbackHyperbolicAttention(
    queries: Float32Array,
    keys: Float32Array,
    values: Float32Array,
    hierarchyLevels: number[],
    startTime: number
  ): HyperbolicAttentionResult {
    const dim = this.hyperbolicConfig.dimension!;
    const numQueries = queries.length / dim;
    const numKeys = keys.length / dim;

    const scores = new Float32Array(numQueries * numKeys);
    const distances: number[] = [];

    for (let i = 0; i < numQueries; i++) {
      for (let j = 0; j < numKeys; j++) {
        let score = 0;
        for (let d = 0; d < dim; d++) {
          score += queries[i * dim + d] * keys[j * dim + d];
        }
        const hierarchyScale = Math.exp(-hierarchyLevels[j] * 0.5);
        score *= hierarchyScale;
        scores[i * numKeys + j] = score;
        distances.push(hierarchyLevels[j]);
      }
    }

    const weights = this.softmax(scores, numQueries, numKeys);

    const attended = new Float32Array(numQueries * dim);
    for (let i = 0; i < numQueries; i++) {
      for (let j = 0; j < numKeys; j++) {
        const weight = weights[i * numKeys + j];
        for (let d = 0; d < dim; d++) {
          attended[i * dim + d] += weight * values[j * dim + d];
        }
      }
    }

    return {
      attended,
      weights,
      distances,
      metrics: {
        computeTimeMs: Date.now() - startTime,
        memoryUsedMB: (attended.byteLength + weights.byteLength) / (1024 * 1024),
      },
    };
  }

  private fallbackFlashAttention(
    queries: Float32Array,
    keys: Float32Array,
    values: Float32Array,
    startTime: number
  ): FlashAttentionResult {
    const dim = this.hyperbolicConfig.dimension ?? getEmbeddingConfig().dimension;
    const numQueries = queries.length / dim;
    const numKeys = keys.length / dim;
    const blockSize = this.flashConfig.blockSize!;

    const output = new Float32Array(numQueries * dim);
    let blocksProcessed = 0;
    let peakMemory = 0;

    for (let qStart = 0; qStart < numQueries; qStart += blockSize) {
      const qEnd = Math.min(qStart + blockSize, numQueries);

      for (let kStart = 0; kStart < numKeys; kStart += blockSize) {
        const kEnd = Math.min(kStart + blockSize, numKeys);

        const blockScores = new Float32Array((qEnd - qStart) * (kEnd - kStart));

        for (let i = qStart; i < qEnd; i++) {
          for (let j = kStart; j < kEnd; j++) {
            let score = 0;
            for (let d = 0; d < dim; d++) {
              score += queries[i * dim + d] * keys[j * dim + d];
            }
            blockScores[(i - qStart) * (kEnd - kStart) + (j - kStart)] = score;
          }
        }

        const blockWeights = this.softmax(blockScores, qEnd - qStart, kEnd - kStart);

        for (let i = qStart; i < qEnd; i++) {
          for (let j = kStart; j < kEnd; j++) {
            const weight = blockWeights[(i - qStart) * (kEnd - kStart) + (j - kStart)];
            for (let d = 0; d < dim; d++) {
              output[i * dim + d] += weight * values[j * dim + d];
            }
          }
        }

        peakMemory = Math.max(peakMemory, blockScores.byteLength + blockWeights.byteLength);
        blocksProcessed++;
      }
    }

    return {
      output,
      metrics: {
        computeTimeMs: Date.now() - startTime,
        peakMemoryMB: peakMemory / (1024 * 1024),
        blocksProcessed,
      },
    };
  }

  private fallbackGraphRoPE(
    queries: Float32Array,
    keys: Float32Array,
    hopDistances: number[][],
    startTime: number
  ): GraphRoPEResult {
    const dim = this.hyperbolicConfig.dimension ?? getEmbeddingConfig().dimension;
    const numQueries = queries.length / dim;
    const numKeys = keys.length / dim;

    const encodedQueries = new Float32Array(queries);
    const encodedKeys = new Float32Array(keys);
    const hopEncodings = new Float32Array(numQueries * numKeys);

    // ADR-0044: 3 GraphRoPE bug fixes
    // Bug 1: || 0 treated missing hops as adjacent — use maxHops (distant) instead
    // Bug 2: encodedKeys[j] modified cumulatively across all queries i
    // Bug 3: encodedQueries[i] modified cumulatively across all keys j
    // Fix: compute per-pair hop encodings without mutating shared query/key arrays
    const maxHops = 10;
    for (let i = 0; i < numQueries; i++) {
      for (let j = 0; j < numKeys; j++) {
        const distance = hopDistances[i]?.[j] ?? maxHops; // Bug 1 fix: missing = far
        const scale = 1.0 / (1.0 + distance);
        hopEncodings[i * numKeys + j] = scale;
      }
    }
    // Apply per-pair positional scaling via hop encodings (not in-place mutation)
    for (let i = 0; i < numQueries; i++) {
      for (let d = 0; d < dim; d++) {
        // Bug 3 fix: scale query by average hop distance to all keys for this query
        let avgScale = 0;
        for (let j = 0; j < numKeys; j++) {
          avgScale += hopEncodings[i * numKeys + j];
        }
        avgScale = numKeys > 0 ? avgScale / numKeys : 1;
        encodedQueries[i * dim + d] *= Math.sqrt(avgScale);
      }
    }
    for (let j = 0; j < numKeys; j++) {
      for (let d = 0; d < dim; d++) {
        // Bug 2 fix: scale key by its hop distance from first query (graph-derived position)
        const hopScale = hopEncodings[j]; // hop from query 0 to key j
        encodedKeys[j * dim + d] *= Math.sqrt(hopScale);
      }
    }

    return {
      queries: encodedQueries,
      keys: encodedKeys,
      hopEncodings,
      metrics: {
        computeTimeMs: Date.now() - startTime,
      },
    };
  }

  private softmax(scores: Float32Array, rows: number, cols: number): Float32Array {
    const result = new Float32Array(scores.length);

    for (let i = 0; i < rows; i++) {
      let max = -Infinity;
      for (let j = 0; j < cols; j++) {
        max = Math.max(max, scores[i * cols + j]);
      }

      let sum = 0;
      for (let j = 0; j < cols; j++) {
        result[i * cols + j] = Math.exp(scores[i * cols + j] - max);
        sum += result[i * cols + j];
      }

      for (let j = 0; j < cols; j++) {
        result[i * cols + j] /= sum;
      }
    }

    return result;
  }

  getConfig() {
    return {
      hyperbolic: this.hyperbolicConfig,
      flash: this.flashConfig,
      graphRoPE: this.graphRoPEConfig,
    };
  }
}
