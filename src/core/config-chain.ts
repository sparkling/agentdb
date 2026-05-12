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
