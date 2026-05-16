// charter: dispatch
// coordination_sync mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<CoordinationSyncPayload>` so every sync transition
// (status / trigger / resolve) flows through the archivist's audit-chain
// (intent → applied | rejected) with guard verdicts + invariant verdicts recorded.
//
// Why mixed-mode actions register as ONE mutation handler (mirrors hive-mind/
// consensus.ts precedent):
//   - status:  reads `store.sync` plus a derived `timeSinceSync`. Pure read shape,
//              but flows through the mutation registration so there is exactly one
//              registry entry per cli tool name.
//   - trigger: mutates `store.sync.{syncCount,lastSync,pendingChanges}`.
//   - resolve: mutates `store.sync.conflicts` (clears outstanding conflicts under
//              the chosen `conflictResolution` strategy).
//
// Pre-existing CLI surface: `cli/src/mcp-tools/coordination-tools.ts`
// `coordination_sync` handler — load → action-switch → mutate → `saveCoordStore`.
// The cli callsite stays in place until the dispatch boundary is wired through
// cli; this file establishes the registration shape.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/coordination/store.json` may mutate. The underlying primitive
// is `makeFsJsonSubstrate` (substrates/fs-json-store.ts), shared with the other
// five `coordination_*` mutation handlers — all six route through the same
// FS-JSON store under one cross-process O_EXCL sentinel lock.

import { registerMutationHandler } from '../../registration.js';
import type { MutationContext } from '../../mutation-context.js';
import type { GuardedWrite, StoreId } from '../../types.js';
import { syncInvariants } from '../../invariants/coordination/sync.js';
import {
  COORD_STORE_KEY,
  loadCoordStore,
  type CoordinationStore,
} from './shared.js';

/** Action discriminator — mirrors the cli tool's inputSchema.action enum. */
export type CoordinationSyncAction = 'status' | 'trigger' | 'resolve';

/** Conflict-resolution strategy — only meaningful for `action: 'resolve'`. */
export type ConflictResolutionStrategy = 'latest' | 'merge' | 'manual';

/**
 * Mutation payload mirroring the CLI tool's `coordination_sync` input shape
 * (coordination-tools.ts inputSchema lines 296-300). All fields optional except
 * `action`; `action` defaults to `'status'` at the wire-up callsite.
 */
export interface CoordinationSyncPayload {
  readonly action?: CoordinationSyncAction;
  readonly force?: boolean;
  readonly conflictResolution?: ConflictResolutionStrategy;
}

const STORE_ID = 'coordination_sync' as StoreId;

// Ports the action-switch body of coordination-tools.ts `coordination_sync`.
// `status` is a pure read in the cli; `trigger` mutates `sync.{syncCount,
// lastSync,pendingChanges}`; `resolve` clears `sync.conflicts`. The cli's
// `loadCoordStore → action-switch → saveCoordStore` collapses to one
// `ctx.substrate.withWrite`. The cli's `trigger` 50ms `setTimeout` sync-delay
// is dropped — it was a cosmetic relic of state-tracking-only mode, not part of
// the mutation.
export const syncCoordinationHandler: GuardedWrite<CoordinationSyncPayload> =
  registerMutationHandler<CoordinationSyncPayload>(
    'coordination_sync',
    async (ctx: MutationContext<false>, payload: CoordinationSyncPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<CoordinationStore>({
          storeId: STORE_ID,
          key: COORD_STORE_KEY,
        });
        const store: CoordinationStore = current ?? loadCoordStore();
        const action: CoordinationSyncAction = payload.action ?? 'status';

        if (action === 'status') {
          return;
        }

        if (action === 'trigger') {
          store.sync.syncCount += 1;
          store.sync.lastSync = new Date().toISOString();
          store.sync.pendingChanges = 0;
          await handle.write({ storeId: STORE_ID, key: COORD_STORE_KEY, payload: store });
          return;
        }

        if (action === 'resolve') {
          if (store.sync.conflicts > 0) {
            store.sync.conflicts = 0;
            await handle.write({ storeId: STORE_ID, key: COORD_STORE_KEY, payload: store });
          }
          // No conflicts to resolve — no write, mirrors the cli's no-op branch.
          return;
        }

        throw new Error(`coordination_sync: unknown action '${String(action)}'`);
      });
    },
    {
      invariants: syncInvariants,
      cacheScope: 'global',
    },
  );
