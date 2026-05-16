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

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';
import { patternStoreInvariants } from '../../invariants/agentdb/pattern-store.js';

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

// ADR-0181 Phase 6 wire-up — port of cli `agentdb-tools.ts:215`. Primary path:
// ReasoningBank controller writes to `reasoning_patterns` SQLite table via
// the narrow `ReasoningBankWriter` capability. Fallback path: substrate.withWrite
// RVF insert under the `'pattern'` namespace when the controller is unwired
// (null return) — surfaces `controller:'memory-store-fallback'` on the
// substrate metadata so audit entries record which path persisted the write
// (ADR-0093 F4 / ADR-0162 Batch E hand-port semantics). ADR-0082
// no-silent-failure: an EXPLICIT error from the controller (`success:false` +
// `error` not matching "not available/wired/initialized") propagates as a
// throw instead of silent RVF coalescing.
export const storePatternHandler: GuardedWrite<AgentdbPatternStorePayload> =
  registerMutationHandler<AgentdbPatternStorePayload>(
    'agentdb_pattern_store',
    async (ctx: MutationContext<false>, payload: AgentdbPatternStorePayload): Promise<void> => {
      const pattern = payload.pattern;
      const type = payload.type ?? 'general';
      const confidence = payload.confidence ?? 0.8;
      const writer = ctx.capabilities.requireReasoningBankWriter();

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const result = await writer.storePattern({ pattern, type, confidence });

        if (result && result.success) {
          // ReasoningBank controller persisted to reasoning_patterns SQLite
          // table. Done — no RVF write needed for the primary path.
          return;
        }
        if (result && !result.success && result.error && !/not available|not wired|not initialized/i.test(result.error)) {
          // Controller ran and refused the write with a real error —
          // surface it loudly per ADR-0082.
          throw new Error(`archivist: agentdb_pattern_store — ReasoningBank rejected: ${result.error}`);
        }

        // Fallback: controller not wired or returned null. Write to RVF under
        // the 'pattern' namespace so the entry remains observable through
        // memory_search (ADR-0093 F4 hand-port). Generate an embedding via
        // the cli-wired EmbeddingScorer capability so vector lookup works
        // (ADR-0069 unified 768-dim model).
        const scorer = ctx.capabilities.requireEmbeddingScorer();
        const embedding = await scorer.embed(pattern);
        const id = `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const rvfHandle = handle as { rvf?: {
          insertAsync(id: string, embedding: Float32Array, metadata?: Record<string, unknown>): Promise<void>;
        } };
        if (!rvfHandle.rvf || typeof rvfHandle.rvf.insertAsync !== 'function') {
          throw new Error(
            'archivist: agentdb_pattern_store — RVF substrate handle missing `rvf.insertAsync`. ' +
            'The cli must call `ensureRvfWired()` before dispatching pattern-store fallback writes.',
          );
        }
        await rvfHandle.rvf.insertAsync(id, embedding, {
          namespace: 'pattern',
          content: pattern,
          type,
          confidence,
          tags: [type, 'reasoning-pattern', 'fallback'],
          controller: 'memory-store-fallback',
        });
      });
    },
    {
      invariants: patternStoreInvariants,
      cacheScope: 'namespace',
    },
  );
