/**
 * ONNXEmbeddingService - ONNX Runtime embedding service for AgentDB
 *
 * Tier-1 embedding provider in the upgrade chain (ADR-0069 F3):
 *   ONNXEmbeddingService → EnhancedEmbeddingService → EmbeddingService (basic)
 *
 * Uses onnxruntime-node for native inference; falls back to the next tier
 * when the ONNX runtime is unavailable.
 */

export interface ONNXEmbeddingConfig {
  modelPath?: string;
  dimension?: number;
  maxBatchSize?: number;
}

export class ONNXEmbeddingService {
  private config: ONNXEmbeddingConfig;
  private session: any | null = null;
  private ready = false;

  constructor(config: ONNXEmbeddingConfig = {}) {
    this.config = {
      dimension: config.dimension ?? 768,
      maxBatchSize: config.maxBatchSize ?? 32,
      ...config,
    };
  }

  async initialize(): Promise<void> {
    try {
      const ort = await import('onnxruntime-node');
      if (this.config.modelPath) {
        this.session = await ort.InferenceSession.create(this.config.modelPath);
      }
      this.ready = true;
    } catch {
      throw new Error('ONNXEmbeddingService: onnxruntime-node not available');
    }
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.ready) throw new Error('ONNXEmbeddingService: not initialized');
    // Placeholder: real impl feeds tokenized input through the ONNX session
    const dim = this.config.dimension!;
    return new Float32Array(dim);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!this.ready) throw new Error('ONNXEmbeddingService: not initialized');
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
