/**
 * AgentDB Security Module — Barrel Exports
 *
 * Consolidates all security primitives: validation, proof-gated mutation,
 * attestation logging, resource limits, and path security.
 */

// ADR-060: Proof-Gated State Mutation
export { MutationGuard } from './MutationGuard.js';
export type {
  MutationProof,
  MutationDenial,
  AttestationToken,
  GuardConfig,
  InvariantResult,
} from './MutationGuard.js';
export { AttestationLog } from './AttestationLog.js';
export type {
  AttestationQueryOptions,
  DatabaseLike,
  DenialPattern,
  AttestationStats,
} from './AttestationLog.js';

// Validation
export {
  validateVector,
  validateVectorId,
  validateSearchOptions,
  SECURITY_LIMITS,
  sanitizeMetadata,
  validateHNSWParams,
  validateBatchSize,
  validateVectorCount,
  validateCypherParams,
  validateLabel,
  safeLog,
} from './validation.js';

// Input validation — `export *` keeps the `./security` subpath a strict
// superset of its previous target (it used to point straight at
// input-validation.js; ADR-0289 repointed it to this barrel so the
// redaction surface is reachable as @sparkleideas/agentdb/security).
export * from './input-validation.js';

// Resource limits & circuit breaker
export {
  SecurityError,
  ResourceTracker,
  RateLimiter,
  CircuitBreaker,
} from './limits.js';

// Path security
export { validatePath } from './path-security.js';

// ADR-0289: PII/secret redaction before durable capture
export {
  redactFreeText,
  AgentDBRedactionError,
  EPISODE_FREE_TEXT_FIELDS,
  isRedactionDisabled,
  isPiiMaskingDisabled,
} from './redaction.js';
export type { RedactionViolation, RedactFreeTextResult } from './redaction.js';
