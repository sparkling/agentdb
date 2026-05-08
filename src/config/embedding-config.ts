/**
 * Centralized embedding configuration — single source of truth.
 * All consumers import from here instead of hardcoding dimensions/models.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ===== Types =====

export interface EmbeddingConfig {
  model: string;
  dimension: number;
  provider: 'transformers' | 'openai' | 'cohere' | 'custom';
  taskPrefixQuery: string;
  taskPrefixIndex: string;
  contextWindow: number;
  // ADR-0069: config-chain capacity — HNSW max elements from embeddings.json hnsw block
  maxElements: number;
}

export interface HNSWParams {
  M: number;
  efConstruction: number;
  efSearch: number;
  maxElements: number; // ADR-0069: config-chain capacity
}

export interface ModelInfo {
  dimension: number;
  contextWindow: number;
  taskPrefixQuery: string;
  taskPrefixIndex: string;
  provider: 'transformers' | 'openai' | 'cohere';
}

// ===== Model Registry =====

export const MODEL_REGISTRY: Record<string, ModelInfo> = {
  // Modern models (recommended)
  'nomic-ai/nomic-embed-text-v1.5': { dimension: 768, contextWindow: 8192, taskPrefixQuery: 'search_query: ', taskPrefixIndex: 'search_document: ', provider: 'transformers' },
  'nomic-embed-text-v1.5': { dimension: 768, contextWindow: 8192, taskPrefixQuery: 'search_query: ', taskPrefixIndex: 'search_document: ', provider: 'transformers' },

  // BGE family
  'Xenova/bge-base-en-v1.5': { dimension: 768, contextWindow: 512, taskPrefixQuery: 'Represent this sentence for searching relevant passages: ', taskPrefixIndex: '', provider: 'transformers' },
  'BAAI/bge-base-en-v1.5': { dimension: 768, contextWindow: 512, taskPrefixQuery: 'Represent this sentence for searching relevant passages: ', taskPrefixIndex: '', provider: 'transformers' },
  'Xenova/bge-small-en-v1.5': { dimension: 384, contextWindow: 512, taskPrefixQuery: 'Represent this sentence for searching relevant passages: ', taskPrefixIndex: '', provider: 'transformers' },
  'Xenova/bge-large-en-v1.5': { dimension: 1024, contextWindow: 512, taskPrefixQuery: 'Represent this sentence for searching relevant passages: ', taskPrefixIndex: '', provider: 'transformers' },

  // Sentence-transformers (legacy)
  'Xenova/all-MiniLM-L6-v2': { dimension: 384, contextWindow: 512, taskPrefixQuery: '', taskPrefixIndex: '', provider: 'transformers' },
  'all-MiniLM-L6-v2': { dimension: 384, contextWindow: 512, taskPrefixQuery: '', taskPrefixIndex: '', provider: 'transformers' },
  'Xenova/all-mpnet-base-v2': { dimension: 768, contextWindow: 512, taskPrefixQuery: '', taskPrefixIndex: '', provider: 'transformers' },
  'all-mpnet-base-v2': { dimension: 768, contextWindow: 512, taskPrefixQuery: '', taskPrefixIndex: '', provider: 'transformers' },

  // GTE
  'Xenova/gte-small': { dimension: 384, contextWindow: 512, taskPrefixQuery: '', taskPrefixIndex: '', provider: 'transformers' },

  // OpenAI
  'text-embedding-ada-002': { dimension: 1536, contextWindow: 8191, taskPrefixQuery: '', taskPrefixIndex: '', provider: 'openai' },
  'text-embedding-3-small': { dimension: 1536, contextWindow: 8191, taskPrefixQuery: '', taskPrefixIndex: '', provider: 'openai' },
  'text-embedding-3-large': { dimension: 3072, contextWindow: 8191, taskPrefixQuery: '', taskPrefixIndex: '', provider: 'openai' },

  // Cohere
  'embed-english-v3.0': { dimension: 1024, contextWindow: 512, taskPrefixQuery: '', taskPrefixIndex: '', provider: 'cohere' },
  'embed-multilingual-v3.0': { dimension: 1024, contextWindow: 512, taskPrefixQuery: '', taskPrefixIndex: '', provider: 'cohere' },
};

// ===== Default config =====

const DEFAULT_MODEL = 'Xenova/all-mpnet-base-v2'; // ADR-0080: canonical model
const DEFAULT_CONFIG: EmbeddingConfig = {
  model: DEFAULT_MODEL,
  dimension: 768,
  provider: 'transformers',
  taskPrefixQuery: '',
  taskPrefixIndex: '',
  contextWindow: 512,
  maxElements: 100000, // ADR-0069: config-chain capacity
};

// ===== Config resolution =====

let _cachedConfig: EmbeddingConfig | null = null;

/**
 * Get the embedding config from layered sources.
 * Priority: explicit override > env vars > embeddings.json > MODEL_REGISTRY > defaults
 */
export function getEmbeddingConfig(overrides?: Partial<EmbeddingConfig>): EmbeddingConfig {
  if (_cachedConfig && !overrides) return _cachedConfig;

  // Layer 1: Start with defaults
  const config = { ...DEFAULT_CONFIG };

  // Layer 2: Read embeddings.json if it exists
  const configPaths = [
    join(process.cwd(), '.claude-flow', 'embeddings.json'),
    join(process.cwd(), '.claude', 'embeddings.json'),
  ];
  for (const configPath of configPaths) {
    try {
      if (existsSync(configPath)) {
        const fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (fileConfig.model) config.model = fileConfig.model;
        if (fileConfig.dimension) config.dimension = fileConfig.dimension;
        if (fileConfig.provider) config.provider = fileConfig.provider;
        if (fileConfig.taskPrefixQuery !== undefined) config.taskPrefixQuery = fileConfig.taskPrefixQuery;
        if (fileConfig.taskPrefixIndex !== undefined) config.taskPrefixIndex = fileConfig.taskPrefixIndex;
        if (fileConfig.contextWindow) config.contextWindow = fileConfig.contextWindow;
        // ADR-0069: config-chain capacity — read maxElements from hnsw block or top-level
        if (fileConfig.hnsw?.maxElements) config.maxElements = fileConfig.hnsw.maxElements;
        if (fileConfig.maxElements) config.maxElements = fileConfig.maxElements;
        break; // Use first found config
      }
    } catch { /* config file may not exist or be invalid */ }
  }

  // Layer 3: Env vars override file config
  if (process.env.AGENTDB_EMBEDDING_MODEL) config.model = process.env.AGENTDB_EMBEDDING_MODEL;
  if (process.env.AGENTDB_EMBEDDING_DIM) config.dimension = parseInt(process.env.AGENTDB_EMBEDDING_DIM, 10);
  if (process.env.AGENTDB_EMBEDDING_PROVIDER) config.provider = process.env.AGENTDB_EMBEDDING_PROVIDER as any;
  // ADR-0069: config-chain capacity
  if (process.env.AGENTDB_MAX_ELEMENTS) config.maxElements = parseInt(process.env.AGENTDB_MAX_ELEMENTS, 10);

  // Layer 4: Auto-derive dimension from MODEL_REGISTRY if model changed but dimension wasn't explicit
  const modelInfo = MODEL_REGISTRY[config.model];
  if (modelInfo) {
    // If dimension wasn't explicitly set (still default), use model's native dimension
    if (!process.env.AGENTDB_EMBEDDING_DIM && config.dimension === DEFAULT_CONFIG.dimension && modelInfo.dimension !== DEFAULT_CONFIG.dimension) {
      config.dimension = modelInfo.dimension;
    }
    // If task prefixes weren't explicitly set, use model's prefixes
    if (config.taskPrefixQuery === DEFAULT_CONFIG.taskPrefixQuery && modelInfo.taskPrefixQuery !== DEFAULT_CONFIG.taskPrefixQuery) {
      config.taskPrefixQuery = modelInfo.taskPrefixQuery;
    }
    if (config.taskPrefixIndex === DEFAULT_CONFIG.taskPrefixIndex && modelInfo.taskPrefixIndex !== DEFAULT_CONFIG.taskPrefixIndex) {
      config.taskPrefixIndex = modelInfo.taskPrefixIndex;
    }
    if (!config.provider || config.provider === DEFAULT_CONFIG.provider) {
      config.provider = modelInfo.provider;
    }
    config.contextWindow = modelInfo.contextWindow;
  }

  // Layer 5: Explicit overrides (highest priority)
  if (overrides) {
    Object.assign(config, overrides);
  }

  // Cache the resolved config (without overrides for reuse)
  if (!overrides) _cachedConfig = config;

  return config;
}

/** Reset cached config (for testing or model switching) */
export function resetEmbeddingConfig(): void {
  _cachedConfig = null;
}

// ===== EWC lambda config helper (ADR-0069 A4) =====

/**
 * Read the EWC++ regularization lambda from `.claude-flow/config.json`.
 * Returns `fallback` when the config file is missing (expected case) or
 * when `neural.ewcLambda` is absent/invalid.
 *
 * ADR-0082: non-existence is a legitimate state (config file is optional),
 * but unexpected errors (parse failures, non-ENOENT I/O errors) are logged
 * loudly via console.warn rather than silently swallowed.
 *
 * Consolidated from duplicates in:
 *   - agentic-flow/src/intelligence/RuVectorIntelligence.ts
 *   - agentic-flow/src/services/sona-agentdb-integration.ts
 *   - agentic-flow/src/mcp/fastmcp/tools/hooks/intelligence-tools.ts
 *   - packages/agentdb/src/backends/rvf/SonaLearningBackend.ts
 */
export function readEwcLambdaFromConfig(fallback: number): number {
  const configPath = join(process.cwd(), '.claude-flow', 'config.json');
  try {
    if (!existsSync(configPath)) return fallback;
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const val = parsed?.neural?.ewcLambda;
    if (typeof val === 'number' && val > 0) return val;
    return fallback;
  } catch (err) {
    // ADR-0082: log loudly rather than silently swallow. File-not-found is
    // handled above; reaching this branch means a real parse/IO failure.
    // eslint-disable-next-line no-console
    console.warn(
      `[embedding-config] readEwcLambdaFromConfig failed for ${configPath}: ${(err as Error)?.message ?? err}. Using fallback=${fallback}.`
    );
    return fallback;
  }
}

/** Look up dimension for a model name */
export function getModelDimension(model: string): number {
  return MODEL_REGISTRY[model]?.dimension ?? MODEL_REGISTRY[`Xenova/${model}`]?.dimension ?? getEmbeddingConfig().dimension;
}

/** Look up task prefix for a model */
export function getTaskPrefix(model: string, intent: 'query' | 'document'): string {
  const info = MODEL_REGISTRY[model] ?? MODEL_REGISTRY[`Xenova/${model}`];
  if (!info) return '';
  return intent === 'query' ? info.taskPrefixQuery : info.taskPrefixIndex;
}

/** Apply task prefix to text based on model and intent */
export function applyTaskPrefix(text: string, intent: 'query' | 'document'): string {
  const config = getEmbeddingConfig();
  const prefix = intent === 'query' ? config.taskPrefixQuery : config.taskPrefixIndex;
  if (!prefix) return text;
  // Don't double-prefix
  if (text.startsWith(prefix)) return text;
  return prefix + text;
}

// ===== HNSW parameter derivation =====

/**
 * Derive optimal HNSW parameters from embedding dimension.
 * M = floor(sqrt(dim) / 1.2), clamped to [8, 48]
 * efConstruction = 4 * M, clamped to [100, 500]
 * efSearch = 2 * M, clamped to [50, 400]
 */
export function deriveHNSWParams(dimension?: number, maxElements?: number): HNSWParams {
  const dim = dimension ?? getEmbeddingConfig().dimension;
  const rawM = Math.floor(Math.sqrt(dim) / 1.2);
  const M = Math.max(8, Math.min(48, rawM));
  const efConstruction = Math.max(100, Math.min(500, 4 * M));
  const efSearch = Math.max(50, Math.min(400, 2 * M));
  // ADR-0069: config-chain capacity
  const resolvedMaxElements = maxElements ?? getEmbeddingConfig().maxElements;
  return { M, efConstruction, efSearch, maxElements: resolvedMaxElements };
}
