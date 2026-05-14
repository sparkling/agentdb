// charter: dispatch
// progress_sync mutation handler (ADR-0180 Phase 5 §Migration concerns).
// FS-JSON consumer: persists V3 progress metrics to `.claude-flow/metrics/
// v3-progress.json` via `ctx.substrate.withWrite` against the shared
// `makeFsJsonSubstrate` primitive (per agents-json.ts precedent — same FS-JSON
// store family, ADR-0180 §10 "~18 stores per primitive").
//
// Pre-existing CLI surface: `cli/src/mcp-tools/progress-tools.ts` `progress_sync`
// handler — calls `syncProgress()` which does `mkdirSync(metricsDir, …)` +
// `writeFileSync(v3-progress.json, …)` directly against the fs. That direct
// write is the mutation this dispatch handler subsumes; the substrate's
// `withWrite` collapses the mkdir + write into one audit-chained transition.
// The cli callsite stays in place until the dispatch boundary is wired
// through cli (Phase 7+), mirroring memory_store / hive-mind_* pending wire-up.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// v3-progress.json mutations may run. Direct `fs.writeFileSync` on the file
// from store-tree code is forbidden by the path-restricted
// substrate-internal.ts seam (ADR-0180 §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/** Persisted progress snapshot — shape mirrors the cli's `syncProgress()`
 *  output (progress-tools.ts lines 224-235) so consumers of v3-progress.json
 *  see no contract change once the dispatch path takes over. */
export interface ProgressSyncRecord {
  readonly domains: { readonly completed: number; readonly total: number };
  readonly ddd: {
    readonly progress: number;
    readonly modules: number;
    readonly totalFiles: number;
    readonly totalLines: number;
  };
  readonly swarm: { readonly activeAgents: number; readonly totalAgents: number };
  readonly lastUpdated: string;
  readonly source: string;
}

/** Mutation payload — the snapshot to persist. The cli's `syncProgress()`
 *  recomputes metrics from the filesystem before writing; that computation
 *  stays on the cli side. This handler owns only the persistence step,
 *  matching the substrate-seam scope (read-mutate-write on one store). */
export interface ProgressSyncPayload {
  readonly snapshot: ProgressSyncRecord;
}

const STORE_ID = 'progress_sync' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of progress-tools.ts
// `syncProgress()` callsite once the dispatch boundary is wired through cli.
// The cli's `mkdirSync` + `writeFileSync` on `.claude-flow/metrics/v3-progress.json`
// collapses to a single `ctx.substrate.withWrite` here because the FS-JSON
// substrate owns the path resolution + atomic write semantics shared with
// hive-state.json / agents.json (ADR-0180 §10).
export const progressSyncHandler: GuardedWrite<ProgressSyncPayload> =
  registerMutationHandler<ProgressSyncPayload>(
    'progress_sync',
    async (ctx: MutationContext<false>, payload: ProgressSyncPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        await handle.write({
          storeId: STORE_ID,
          key: 'root',
          payload: payload.snapshot,
        });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
