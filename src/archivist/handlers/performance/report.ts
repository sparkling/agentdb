// charter: dispatch
// performance_report mutation handler (ADR-0180 Phase 5 §Migration concerns).
// FS-JSON consumer: persists rolling performance metrics to
// `.claude-flow/performance/metrics.json` via `ctx.substrate.withWrite`
// against the shared `makeFsJsonSubstrate` primitive (same FS-JSON store
// family as agents.json / hive-state.json, ADR-0180 §10 "~18 stores per
// primitive").
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/
// performance-tools.ts` `performance_report` handler (lines 86-213) —
// `loadPerfStore()` + `savePerfStore()` pair directly call `readFileSync` /
// `writeFileSync` against the unsynchronised fs. That unlocked read-mutate-
// write is the mutation this dispatch handler subsumes; the substrate's
// `withWrite` collapses the pair into one audit-chained transition under the
// O_EXCL flock per `feedback-data-loss-zero-tolerance`. The cli callsite
// stays in place until Phase 7+ flips the dispatch wire-up.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// metrics.json mutations may run. Direct `fs.writeFileSync` on the file from
// store-tree code is forbidden by the path-restricted substrate-internal.ts
// seam (ADR-0180 §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/** Per-sample performance snapshot — shape mirrors the cli's `PerfMetrics`
 *  interface (performance-tools.ts:26-33) so on-disk metrics.json round-trips
 *  without a schema migration once the dispatch path takes over. */
export interface PerfMetricsRecord {
  readonly timestamp: string;
  readonly cpu: { readonly usage: number; readonly cores: number };
  readonly memory: {
    readonly used: number;
    readonly total: number;
    readonly heap: number;
  };
  readonly latency: {
    readonly avg: number;
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
  };
  readonly throughput: {
    readonly requests: number;
    readonly operations: number;
  };
  readonly errors: { readonly count: number; readonly rate: number };
}

/** Persisted store shape — mirrors the cli's `PerfStore` interface
 *  (performance-tools.ts:48-52). The `benchmarks` field is intentionally
 *  retained on the canonical store; performance_benchmark mutations land in
 *  the dedicated `benchmark-volatile` store (see ./benchmark.ts) and the
 *  legacy `benchmarks: {}` field stays empty on this path. */
export interface PerfStoreRecord {
  readonly metrics: ReadonlyArray<PerfMetricsRecord>;
  readonly benchmarks: Readonly<Record<string, never>>;
  readonly version: string;
}

/** Mutation payload — the freshly-sampled metrics snapshot to append. The
 *  cli's handler computes the snapshot from `process.memoryUsage()`,
 *  `os.loadavg()`, a self-latency probe, and recent-history aggregation;
 *  that computation stays on the cli side. This handler owns only the
 *  persistence step (append + roll-off at 100 samples), matching the
 *  substrate-seam scope (read-mutate-write on one store). */
export interface PerfReportPayload {
  readonly sample: PerfMetricsRecord;
}

const STORE_ID = 'performance_metrics' as StoreId;
const MAX_HISTORY = 100;

// TODO(ADR-0180 Phase 5 wire-up): port the body of performance-tools.ts
// `performance_report` callsite (sample collection + roll-off at 100 entries)
// once the dispatch boundary is wired through cli. The cli's
// `loadPerfStore` + mutate + `savePerfStore` triple collapses to a single
// `ctx.substrate.withWrite` here because `makeFsJsonSubstrate` owns the
// path resolution + atomic write semantics shared with agents.json /
// hive-state.json (ADR-0180 §10).
export const performanceReportHandler: GuardedWrite<PerfReportPayload> =
  registerMutationHandler<PerfReportPayload>(
    'performance_report',
    async (ctx: MutationContext<false>, payload: PerfReportPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<PerfStoreRecord>({
          storeId: STORE_ID,
          key: 'root',
        });
        const baseline: PerfStoreRecord = current ?? {
          metrics: [],
          benchmarks: {},
          version: '3.0.0',
        };

        const appended: PerfMetricsRecord[] = [...baseline.metrics, payload.sample];
        const rolled =
          appended.length > MAX_HISTORY ? appended.slice(-MAX_HISTORY) : appended;

        const next: PerfStoreRecord = {
          metrics: rolled,
          benchmarks: baseline.benchmarks,
          version: baseline.version,
        };

        await handle.write({ storeId: STORE_ID, key: 'root', payload: next });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
