// charter: dispatch
// agentdb_pattern_store mutation handler (ADR-0180 Phase 6 §Architecture · Audit
// chain). Registers as `GuardedWrite<AgentdbPatternStorePayload>` so every
// ReasoningBank pattern write transitions through the archivist's audit-chain
// (intent → applied | rejected) with guard verdicts + invariant verdicts
// recorded.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_pattern-store` handler (line 215) — validates `pattern` (non-empty,
// max 100KB), `type` (default `'general'`), `confidence` via `validateScore`
// (default 0.8), then delegates to `storePattern(...)` against the
// ReasoningBank controller. When the controller registry returns null
// (audit-reported "AgentDB bridge not available" even though
// `agentdb_health.reasoningBank.enabled === true`), the cli falls back to a
// direct `routeMemoryOp({ type: 'store', namespace: 'pattern', ... })` write,
// surfacing `controller: 'memory-store-fallback'` so the path is observable
// (ADR-0093 F4 / ADR-0162 Batch E hand-port). The cli callsite stays
// authoritative during the migration window — this file establishes the
// registration shape the dispatch path will resolve.
//
// Type-enforcement: returning `GuardedWrite<AgentdbPatternStorePayload>` from
// `registerMutationHandler` produces a branded value that the store barrel's
// `Record<string, GuardedWrite<any> | GuardedRead<any, any>>` typing accepts;
// non-branded exports fail at the boundary (ADR-0180 §Type enforcement). The
// `cacheScope: 'namespace'` hint pairs the write with the `'pattern'` namespace
// the ReasoningBank fallback path also uses, so cache invalidation aligns
// across primary and fallback persistence sites.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/**
 * Mutation payload mirroring the CLI tool's `agentdb_pattern-store` input
 * shape (agentdb-tools.ts:217-225). `pattern` is required; `type` defaults to
 * `'general'` and `confidence` defaults to `0.8` via `validateScore`. Both
 * default-application and length validation happen at the dispatch boundary
 * during wire-up.
 */
export interface AgentdbPatternStorePayload {
  readonly pattern: string;
  readonly type?: string;
  readonly confidence?: number;
}

const STORE_ID = 'agentdb_pattern_store' as StoreId;

// TODO(ADR-0180 Phase 6 wire-up): port the body of agentdb-tools.ts
// `agentdb_pattern-store` handler — (a) resolve the ReasoningBank controller
// via ctx.substrate; (b) call `storePattern({ pattern, type, confidence })`;
// (c) on null result, fall back to `memory_store` write under the `'pattern'`
// namespace with tags `[type, 'reasoning-pattern', 'fallback']` and
// `controller: 'memory-store-fallback'` provenance so the audit entry records
// which path persisted the write (ADR-0082 no-silent-failure). The cli branch
// stays in place until the dispatch boundary is wired through; this handler
// is the registration shape the dispatch path will resolve.
export const storePatternHandler: GuardedWrite<AgentdbPatternStorePayload> =
  registerMutationHandler<AgentdbPatternStorePayload>(
    'agentdb_pattern_store',
    async (ctx: MutationContext<false>, _payload: AgentdbPatternStorePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: agentdb_pattern_store handler body pending Phase 6 wire-up; ' +
          'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts agentdb_pattern-store handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );
