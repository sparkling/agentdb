// charter: dispatch
// daemon_runMap mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers the 15-minute scheduled `map` worker write as a
// `GuardedWrite<MapWorkerPayload>` so each codebase-map snapshot transition
// flows through the archivist's audit-chain (intent → applied | rejected) with
// guard verdicts + invariant verdicts recorded.
//
// Pre-existing daemon callsite: `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts`
// `runMapWorker` method (line 1321), reached via the scheduler entry
// `{ type: 'map', intervalMs: 15 * 60 * 1000, ... }` (line 107) and the
// dispatch switch at line 1237. The worker writes
// `.claude-flow/metrics/codebase-map.json` via `writeFileSync` — under
// ADR-0180 F4-3 the daemon callsite stays in place; this file establishes the
// registration shape the dispatch path will resolve once wired.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/metrics/codebase-map.json` may mutate. The underlying
// primitive is `makeFsJsonSubstrate` (substrates/fs-json-store.ts), shared
// across daemon worker writes under one cross-process O_EXCL sentinel lock.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/**
 * Mutation payload for the daemon-scheduled codebase-map worker. The
 * `runMapWorker` method (worker-daemon.ts:1321-1344) takes no caller-supplied
 * arguments; the payload is intentionally empty so the audit record captures
 * "the scheduler fired" without coupling to internal worker state.
 */
export interface MapWorkerPayload {
  // intentionally empty — daemon-scheduled, no external inputs
}

const STORE_ID = 'metrics_codebase_map' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up, F4-3 deferral): port the scan body of
// worker-daemon.ts `runMapWorker` (lines 1321-1344) once the dispatch
// boundary is wired through the daemon. The current cli body composes a
// `{ timestamp, projectRoot, structure: { hasPackageJson, hasTsConfig,
// hasClaudeConfig, hasClaudeFlow }, scannedAt }` snapshot via four
// `existsSync` probes and then `writeFileSync(.../codebase-map.json, ...)`.
// Probes are read-only filesystem reads and therefore stay outside the
// `withWrite` scope; only the final JSON write moves inside.
export const mapWorkerHandler: GuardedWrite<MapWorkerPayload> =
  registerMutationHandler<MapWorkerPayload>(
    'daemon_runMap',
    async (ctx: MutationContext<false>, _payload: MapWorkerPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: daemon_runMap handler body pending Phase 5 wire-up; ' +
          'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts ' +
          '\'runMapWorker\' method',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
