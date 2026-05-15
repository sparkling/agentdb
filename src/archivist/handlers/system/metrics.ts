// charter: dispatch
// system_metrics mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers as `GuardedWrite<SystemMetricsPayload>` so every metrics refresh
// transitions through the archivist's audit-chain (intent → applied | rejected)
// with guard verdicts + invariant verdicts recorded.
//
// Why a read-shaped cli surface registers as a MUTATION handler:
//   - The cli `system_metrics` handler returns the current metrics snapshot, but
//     internally REFRESHES `lastCheck`, CPU load, memory usage, and the cached
//     agent/task counts every call, then calls `saveMetrics(currentMetrics)` —
//     a side-effecting whole-document rewrite. The cli's read-shaped return is
//     dressed over a write. The audit chain is designed to record exactly this
//     class of refresh-on-read; one registry entry per cli tool name.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/system-tools.ts`
// `system_metrics` handler (lines 137-280). The cli callsite stays in place
// until the dispatch boundary is wired through cli; this file establishes the
// registration shape the dispatch path will resolve.
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
} from '../../index.js';

/** Metrics category — mirrors the CLI inputSchema enum (system-tools.ts:144). */
export type SystemMetricsCategory =
  | 'all'
  | 'cpu'
  | 'memory'
  | 'agents'
  | 'tasks'
  | 'requests';

/** Output format — mirrors system-tools.ts:146. */
export type SystemMetricsFormat = 'json' | 'table' | 'summary';

/**
 * Mutation payload mirroring the CLI tool's `system_metrics` input shape
 * (system-tools.ts inputSchema lines 142-148). All fields optional;
 * `category` defaults to `'all'` at the wire-up callsite.
 */
export interface SystemMetricsPayload {
  readonly category?: SystemMetricsCategory;
  readonly timeRange?: string;
  readonly format?: SystemMetricsFormat;
}

const STORE_ID = 'system_metrics' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the metrics-refresh body of
// system-tools.ts `system_metrics` callsite (lines 149-279) once the dispatch
// boundary is wired through cli. The cli's `loadMetrics` → real-metrics-via-
// `process.memoryUsage()`/`os.loadavg()` → AgentDB-or-JSON-store agent/task
// count fallback → `saveMetrics` pipeline collapses to a single
// `ctx.substrate.withWrite` here because `makeFsJsonSubstrate` owns the lock
// semantics. The AgentDB-first / JSON-fallback path (system-tools.ts:166-225)
// is an out-of-band read — it does NOT mutate `.claude-flow/system/metrics.json`
// and therefore stays outside the `withWrite` scope; only the final
// `saveMetrics(currentMetrics)` write moves inside.
export const systemMetricsHandler: GuardedWrite<SystemMetricsPayload> =
  registerMutationHandler<SystemMetricsPayload>(
    'system_metrics',
    async (ctx: MutationContext<false>, _payload: SystemMetricsPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: system_metrics handler body pending Phase 5 wire-up; ' +
          'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/system-tools.ts ' +
          '\'system_metrics\' handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
