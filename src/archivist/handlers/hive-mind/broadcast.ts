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
} from '../../index.js';
import type { HiveStateDoc } from './hive-state.js';

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

/** Max retained broadcast messages — matches the cli trim-to-100 contract. */
const MAX_BROADCASTS = 100;

// Ported from cli/src/mcp-tools/hive-mind-tools.ts `hive-mind_broadcast` handler
// (lines 2822-2864). The cli's `loadHiveState → append → trim-to-100 →
// saveHiveState under withHiveStoreLock` collapses to a single
// `ctx.substrate.withWrite`: the substrate primitive owns the lock semantics
// the cli's outer `withHiveStoreLock` provided. Broadcasts are operational
// system state (ADR-0122 T4) — stored as a permanent `system`-typed
// `MemoryEntry` under `sharedMemory.broadcasts`, trimmed to the last 100.
export const broadcastHiveMindHandler: GuardedWrite<HiveMindBroadcastPayload> =
  registerMutationHandler<HiveMindBroadcastPayload>(
    'hive-mind_broadcast',
    async (ctx: MutationContext<false>, payload: HiveMindBroadcastPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const state = await handle.read<HiveStateDoc>({ storeId: STORE_ID, key: 'root' });
        if (!state || !state.initialized) {
          throw new Error('hive-mind_broadcast: hive-mind not initialized');
        }

        const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const now = Date.now();
        const existing = state.sharedMemory.broadcasts;
        const priorMessages =
          existing && Array.isArray(existing.value)
            ? [...(existing.value as Array<unknown>)]
            : [];
        priorMessages.push({
          messageId,
          message: payload.message,
          priority: payload.priority ?? 'normal',
          fromId: payload.fromId ?? 'system',
          timestamp: new Date().toISOString(),
        });

        state.sharedMemory.broadcasts = {
          value: priorMessages.slice(-MAX_BROADCASTS),
          type: 'system',
          ttlMs: null,
          expiresAt: null,
          createdAt: existing ? existing.createdAt : now,
          updatedAt: now,
        };

        await handle.write({ storeId: STORE_ID, key: 'root', payload: state });
      });
    },
    {
      // The natural invariant here (broadcast count never regresses and never
      // exceeds MAX_BROADCASTS) needs the substrate before/after snapshots,
      // which the dispatch boundary does not yet populate (index.ts passes
      // `substrateStateBefore/After: undefined` pending the ADR-0180 snapshot
      // wiring). Authoring it now would false-positive on every dispatch —
      // left to invariants-author once the snapshot seam lands. Matches every
      // other un-stubbed handler (agents-json.ts, tasks/*.ts).
      invariants: [],
      cacheScope: 'global',
    },
  );
