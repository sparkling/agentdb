// charter: dispatch
// system_reset mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers as `GuardedWrite<SystemResetPayload>` so every reset transition flows
// through the archivist's audit-chain (intent → applied | rejected) with guard
// verdicts + invariant verdicts recorded. The audit trail is especially
// load-bearing here — `system_reset` is a destructive, idempotent overwrite of
// `.claude-flow/system/metrics.json`; observers replay the chain to recover the
// pre-reset metrics snapshot when needed.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/system-tools.ts`
// `system_reset` handler (lines 447-488). The cli callsite stays in place until
// the dispatch boundary is wired through cli; this file establishes the
// registration shape the dispatch path will resolve. Note the cli surface
// requires `confirm: true` (inputSchema.required); the dispatch wire-up should
// reject `confirm: false` payloads at the registration boundary (invariants-
// author) rather than returning the cli's `{ success: false }` object.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/system/metrics.json` may mutate. The underlying primitive is
// `makeFsJsonSubstrate` (substrates/fs-json-store.ts), shared with the other
// `system_*` mutation handlers — all three route through the same FS-JSON
// store under one cross-process O_EXCL sentinel lock.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/** Reset target — mirrors the CLI surface's `component` string field.
 *  The cli accepts `'all' | 'metrics' | 'agents' | 'tasks'` but only ever
 *  resets the metrics file regardless of the value (system-tools.ts:464-479);
 *  the discriminator is retained for audit-chain observability. */
export type SystemResetComponent = 'all' | 'metrics' | 'agents' | 'tasks';

/**
 * Mutation payload mirroring the CLI tool's `system_reset` input shape
 * (system-tools.ts inputSchema lines 451-458). `confirm` is required by the
 * cli inputSchema; `component` defaults to `'metrics'` at the wire-up callsite.
 */
export interface SystemResetPayload {
  readonly component?: SystemResetComponent;
  readonly confirm: boolean;
}

const STORE_ID = 'system_metrics' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the reset body of system-tools.ts
// `system_reset` callsite (lines 459-487) once the dispatch boundary is wired
// through cli. The cli's `confirm`-check → default-metrics-construction →
// `saveMetrics(defaultMetrics)` pipeline collapses to a single
// `ctx.substrate.withWrite` here because `makeFsJsonSubstrate` owns the lock
// semantics. The `confirm: false` early-return should move to an invariant
// (invariants-author) so the audit chain records `rejected` rather than a
// silent applied-with-no-op.
export const systemResetHandler: GuardedWrite<SystemResetPayload> =
  registerMutationHandler<SystemResetPayload>(
    'system_reset',
    async (ctx: MutationContext<false>, _payload: SystemResetPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: system_reset handler body pending Phase 5 wire-up; ' +
          'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/system-tools.ts ' +
          '\'system_reset\' handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
