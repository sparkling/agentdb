// charter: dispatch
// system_health mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers as `GuardedWrite<SystemHealthPayload>` so every health-check transition
// flows through the archivist's audit-chain (intent → applied | rejected) with
// guard verdicts + invariant verdicts recorded.
//
// Why a read-shaped cli surface registers as a MUTATION handler:
//   - The cli `system_health` handler computes a health score over a fixed set of
//     component probes (memory store, config, mcp, swarm, neural, optionally disk
//     / network / database) and then UPDATES `metrics.health` via
//     `saveMetrics(metrics)` (system-tools.ts:394-395). The audit chain records
//     this score-write so observers can replay the health timeline. One registry
//     entry per cli tool name.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/system-tools.ts`
// `system_health` handler (lines 281-411). The cli callsite stays in place until
// the dispatch boundary is wired through cli; this file establishes the
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
} from '../../index';

/**
 * Mutation payload mirroring the CLI tool's `system_health` input shape
 * (system-tools.ts inputSchema lines 285-292). All fields optional;
 * defaults applied at the wire-up callsite.
 */
export interface SystemHealthPayload {
  readonly deep?: boolean;
  readonly components?: ReadonlyArray<string>;
  readonly fix?: boolean;
}

const STORE_ID = 'system_metrics' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the health-probe body of system-tools.ts
// `system_health` callsite (lines 293-410) once the dispatch boundary is wired
// through cli. The cli's probe-sequence (memory store `existsSync`, config file
// `existsSync`, MCP stdio detect, swarm/neural unknown, deep: disk/network/
// database) → score computation → `saveMetrics(metrics)` collapses to a single
// `ctx.substrate.withWrite` here because `makeFsJsonSubstrate` owns the lock
// semantics. Probes themselves are read-only filesystem `existsSync` calls and
// therefore stay outside the `withWrite` scope; only the final `metrics.health`
// score-write moves inside. The `fix` flag is currently unused in the cli
// (system-tools.ts:291) — invariants-author should record the no-op contract
// or wire-up should implement the deferred autoremediation path.
export const systemHealthHandler: GuardedWrite<SystemHealthPayload> =
  registerMutationHandler<SystemHealthPayload>(
    'system_health',
    async (ctx: MutationContext<false>, _payload: SystemHealthPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: system_health handler body pending Phase 5 wire-up; ' +
          'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/system-tools.ts ' +
          '\'system_health\' handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
