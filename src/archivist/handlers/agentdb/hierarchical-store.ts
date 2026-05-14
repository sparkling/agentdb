// charter: dispatch
// agentdb_hierarchical_store mutation handler (ADR-0180 Phase 6 §Architecture
// · Audit chain). Registers as `GuardedWrite<AgentdbHierarchicalStorePayload>`
// so every hierarchical-memory write transitions through the archivist's
// audit-chain (intent → applied | rejected) with guard verdicts + invariant
// verdicts recorded.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_hierarchical-store` handler (line 465) — validates `key`
// (non-empty, max 1KB), `value` (non-empty, max 100KB), and `tier` (enum
// `'working' | 'episodic' | 'semantic'`, default `'working'`). Rejects
// invalid tiers explicitly via an `Invalid tier` error string. Delegates to
// `hierarchicalStore({ key, value, tier })`. Returns
// `{ success: false, error: 'AgentDB not available...' }` on missing
// controller. The cli callsite stays authoritative during the migration
// window — this file establishes the registration shape the dispatch path
// will resolve.
//
// Type-enforcement: the `tier` enum is enforced at the type level here
// (`HierarchicalTier` union) — the cli's runtime check against an
// `['working', 'episodic', 'semantic']` array survives during the migration
// window and converts to a typed-payload invariant during Phase 6 wire-up.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/**
 * Hierarchical memory tier — mirrors the cli enum constraint
 * (agentdb-tools.ts:472-477). The three tiers reflect the working / episodic
 * / semantic memory hierarchy (ADR-0044 / HierarchicalMemory controller).
 */
export type HierarchicalTier = 'working' | 'episodic' | 'semantic';

/**
 * Mutation payload mirroring the CLI tool's `agentdb_hierarchical-store`
 * input shape (agentdb-tools.ts:467-480). `key` and `value` are required;
 * `tier` defaults to `'working'`. The cli enforces lengths inline
 * (`key` ≤ 1KB, `value` ≤ 100KB) via `validateString` — these become
 * boundary-validation predicates during Phase 6 wire-up.
 */
export interface AgentdbHierarchicalStorePayload {
  readonly key: string;
  readonly value: string;
  readonly tier?: HierarchicalTier;
}

const STORE_ID = 'agentdb_hierarchical_store' as StoreId;

// TODO(ADR-0180 Phase 6 wire-up): port the body of agentdb-tools.ts
// `agentdb_hierarchical-store` handler — (a) resolve the HierarchicalMemory
// controller via ctx.substrate; (b) call `hierarchicalStore({ key, value,
// tier })`; (c) surface controller-unavailable as an explicit rejection
// rather than silent fallback (ADR-0082 no-silent-failure). The cli branch
// stays in place until the dispatch boundary is wired through; this handler
// is the registration shape the dispatch path will resolve.
export const storeHierarchicalHandler: GuardedWrite<AgentdbHierarchicalStorePayload> =
  registerMutationHandler<AgentdbHierarchicalStorePayload>(
    'agentdb_hierarchical_store',
    async (ctx: MutationContext<false>, _payload: AgentdbHierarchicalStorePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: agentdb_hierarchical_store handler body pending Phase 6 wire-up; ' +
          'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts agentdb_hierarchical-store handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );
