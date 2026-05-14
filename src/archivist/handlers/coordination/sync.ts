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

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

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

// TODO(ADR-0180 Phase 5 wire-up): port the action-switch body of
// coordination-tools.ts `coordination_sync` callsite once the dispatch boundary
// is wired through cli. The wrapper-in-cli pattern (loadCoordStore →
// action-switch → mutate → saveCoordStore via direct writeFileSync) collapses
// to a single `ctx.substrate.withWrite` here because `makeFsJsonSubstrate` owns
// the lock semantics. Note: the cli's `trigger` includes a 50ms
// `setTimeout`-simulated sync delay — that's behaviour-equivalent at the
// mutation surface (one write per call) but invariants-author should drop the
// artificial delay during wire-up; it's a cosmetic relic of state-tracking-only
// mode.
export const syncCoordinationHandler: GuardedWrite<CoordinationSyncPayload> =
  registerMutationHandler<CoordinationSyncPayload>(
    'coordination_sync',
    async (ctx: MutationContext<false>, _payload: CoordinationSyncPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: coordination_sync handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/coordination-tools.ts ' +
          '\'coordination_sync\' handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
