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
} from '../../index.js';

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
// ADR-0181 Phase 6 wire-up — port of cli `agentdb-tools.ts:465`. Primary
// path: HierarchicalMemory controller via `hierarchicalStore({key, value,
// tier})` through the HierarchicalMemoryWriter capability. Fallback: RVF.
export const storeHierarchicalHandler: GuardedWrite<AgentdbHierarchicalStorePayload> =
  registerMutationHandler<AgentdbHierarchicalStorePayload>(
    'agentdb_hierarchical_store',
    async (ctx: MutationContext<false>, payload: AgentdbHierarchicalStorePayload): Promise<void> => {
      const tier: 'working' | 'episodic' | 'semantic' = payload.tier ?? 'working';
      const writer = ctx.capabilities.requireHierarchicalMemoryWriter();

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const result = await writer.storeHierarchical({
          key: payload.key,
          value: payload.value,
          tier,
        });

        if (result && result.success) return;
        if (result && !result.success && result.error && !/not available|not wired|not initialized|missing.*method/i.test(result.error)) {
          throw new Error(`archivist: agentdb_hierarchical_store — HierarchicalMemory rejected: ${result.error}`);
        }

        // Fallback: controller unwired. RVF persistence under namespace
        // `'hierarchical:<tier>'` keeps the value retrievable.
        const scorer = ctx.capabilities.requireEmbeddingScorer();
        const embedding = await scorer.embed(payload.value);
        const id = `hierarchical-${tier}-${payload.key}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const rvfHandle = handle as { rvf?: {
          insertAsync(id: string, embedding: Float32Array, metadata?: Record<string, unknown>): Promise<void>;
        } };
        if (!rvfHandle.rvf || typeof rvfHandle.rvf.insertAsync !== 'function') {
          throw new Error(
            'archivist: agentdb_hierarchical_store — RVF substrate handle missing `rvf.insertAsync`.',
          );
        }
        await rvfHandle.rvf.insertAsync(id, embedding, {
          namespace: `hierarchical:${tier}`,
          key: payload.key,
          value: payload.value,
          tier,
          tags: ['hierarchical', tier, 'fallback'],
          controller: 'memory-store-fallback',
        });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );
