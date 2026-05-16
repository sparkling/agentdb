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

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';
import { defaultSystemMetrics } from './metrics.js';

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

// Body ported from system-tools.ts `system_reset` handler (lines 459-487).
// The cli's `confirm`-check → default-metrics-construction →
// `saveMetrics(defaultMetrics)` pipeline collapses into the single
// `ctx.substrate.withWrite` because the substrate primitive owns durability +
// isolation.
//
// `confirm: false` is rejected with a throw BEFORE the substrate write opens —
// the cli's silent `{ success: false }` early-return (system-tools.ts:460-462)
// becomes a hard rejection so the dispatch envelope's audit chain records
// `rejected` rather than an applied-with-no-op (per the stub's invariants
// note + `feedback-no-fallbacks`). `component` is retained for audit-chain
// observability but, exactly as in the cli (system-tools.ts:464-479), the
// reset always overwrites the metrics document regardless of its value.
export const systemResetHandler: GuardedWrite<SystemResetPayload> =
  registerMutationHandler<SystemResetPayload>(
    'system_reset',
    async (ctx: MutationContext<false>, payload: SystemResetPayload): Promise<void> => {
      if (!payload.confirm) {
        throw new Error(
          'archivist: system_reset requires confirm: true — refusing destructive ' +
            'metrics-document overwrite without explicit confirmation',
        );
      }

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        await handle.write({
          storeId: STORE_ID,
          key: 'root',
          payload: defaultSystemMetrics(),
        });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
