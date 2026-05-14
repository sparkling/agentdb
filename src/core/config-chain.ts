/**
 * Thin re-export of @claude-flow/config-chain (ADR-0177 Phase 1.6 refactor).
 *
 * Previously this file mirrored the canonical accessor in
 * `forks/ruflo/v3/@claude-flow/memory/src/resolve-config.ts` because memory
 * already depended on agentdb (cycle prevention). The shared package
 * `@claude-flow/config-chain` (published as `@sparkleideas/config-chain` after
 * codemod) hosts the canonical impl now; both memory and agentdb consume it.
 *
 * Internal agentdb modules still import from `'../core/config-chain.js'`
 * unchanged — this re-export preserves the existing in-fork import surface so
 * the refactor is a re-route, not a rewrite.
 *
 * `src/index.ts` re-exports the same symbols downstream so consumers of
 * `agentdb` (or `@sparkleideas/agentdb` post-codemod) keep the existing
 * external API as well.
 */
export {
  getConfig,
  getEmbeddingConfig,
  resetConfig,
  isConfigOnDisk,
  validateBoot,
  ConfigChainValidationError,
  EmbeddingDimensionMismatchError,
} from '@claude-flow/config-chain';

export type {
  ConfigChain,
  EmbeddingChainConfig,
} from '@claude-flow/config-chain';

/**
 * Derive optimal HNSW parameters from embedding dimension (ADR-0065 P3-3).
 * Single source of truth consumed by agentdb-backend in @claude-flow/memory.
 * M = floor(sqrt(dim) / 1.2), clamped [8, 48].
 */
export function deriveHNSWParams(dimension: number, maxElements: number = 100000): {
  M: number; efConstruction: number; efSearch: number; maxElements: number;
} {
  const rawM = Math.floor(Math.sqrt(dimension) / 1.2);
  const M = Math.max(8, Math.min(48, rawM));
  const efConstruction = Math.max(100, Math.min(500, 4 * M));
  const efSearch = Math.max(50, Math.min(400, 2 * M));
  return { M, efConstruction, efSearch, maxElements };
}
