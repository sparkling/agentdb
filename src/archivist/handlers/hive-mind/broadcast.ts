// charter: dispatch
// hive-mind_broadcast mutation handler (ADR-0180 Phase 3, §Architecture · Audit chain).
// Registers as `GuardedWrite<HiveMindBroadcastPayload>` so every broadcast
// transitions through the archivist's audit-chain (intent → applied | rejected)
// with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/hive-mind-tools.ts`
// `hive-mind_broadcast` handler — appends a typed entry to
// `state.sharedMemory.broadcasts.value` (ADR-0122 T4: broadcasts are
// operational system state) and trims to the last 100 messages, then
// `saveHiveState`s under `withHiveStoreLock` for ADR-0129 (B1) serialization.
// The cli callsite stays in place until the dispatch boundary is wired
// through cli (mirroring memory_store and hive-mind_agents pending wire-up).
// This file establishes the registration shape the dispatch path will resolve.
//
// Per ADR-0140 §Decision the dialectic-via-broadcast pathway is aspirational
// — broadcast reaches only substrate-registered workers (recorded by
// `hive-mind spawn`), NOT Agent-tool spawns. The mutation surface is the
// same regardless: append, trim, persist.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// hive-mind broadcast state may mutate. Direct fs writes are forbidden by
// the `no-restricted-imports` backstop and the path-restricted
// substrate-internal.ts seam (ADR-0180 §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/** Broadcast priority — matches the CLI inputSchema enum. */
export type BroadcastPriority = 'low' | 'normal' | 'high' | 'critical';

/** Mutation payload mirroring the CLI tool's input shape. `fromId` defaults
 *  to 'system' and `priority` defaults to 'normal' at the wire-up callsite. */
export interface HiveMindBroadcastPayload {
  readonly message: string;
  readonly priority?: BroadcastPriority;
  readonly fromId?: string;
}

const STORE_ID = 'hive-mind_broadcast' as StoreId;

// TODO(ADR-0180 Phase 3 wire-up): port the body of hive-mind-tools.ts
// `hive-mind_broadcast` callsite once the dispatch boundary is wired through
// cli. The wrapper-in-cli pattern (loadHiveState → append BroadcastRecord →
// trim-to-100 → saveHiveState under `withHiveStoreLock`) collapses to a
// single `ctx.substrate.withWrite` here because the primitive owns the lock
// semantics. The cli's outer call to `withHiveStoreLock` becomes redundant
// and is removed in the same commit that flips the dispatch wire-up.
export const broadcastHiveMindHandler: GuardedWrite<HiveMindBroadcastPayload> =
  registerMutationHandler<HiveMindBroadcastPayload>(
    'hive-mind_broadcast',
    async (ctx: MutationContext<false>, _payload: HiveMindBroadcastPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: hive-mind_broadcast handler body pending Phase 3 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/hive-mind-tools.ts hive-mind_broadcast handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
