// charter: dispatch
// performance_benchmark mutation handler (ADR-0180 Phase 5 §Migration
// concerns, Open Follow-up #14 Site 2).
//
// FS-JSON consumer: persists the most-recent benchmark run to a dedicated
// `benchmark-volatile` namespace (StoreId `performance_benchmark_volatile`)
// via `ctx.substrate.withWrite` against the shared `makeFsJsonSubstrate`
// primitive. The volatile namespace is OVERWRITE-NOT-APPEND: every
// `performance_benchmark` invocation replaces the store contents with the
// current run's results — there is no historical retention on this path.
// Treat the namespace as ephemeral; readers must not depend on continuity
// across invocations.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/
// performance-tools.ts` `performance_benchmark` handler (lines 235-365) ran
// `store.benchmarks[id] = result` on the SAME metrics.json document used by
// performance_report, with `id = bench-${suite}-${Date.now()}` keys. Every
// invocation appended one entry per suite-iteration (4 suites × 100 default
// iterations on `suite='all'` → up to 20+ persisted entries per run with no
// roll-off cap), growing metrics.json unboundedly. ADR-0180 Open Follow-up
// #14 Site 2 flagged this as a fork-permanence leak: ephemeral micro-
// benchmarks do not belong on the same durable surface as the rolling
// performance_report history (./report.ts).
//
// Fix landed here: the benchmark run lands in a separate StoreId (`benchmark
// -volatile`) and the handler writes the FULL run as one record (not an
// append). The substrate's `withWrite` semantics replace the prior value,
// auto-clearing the namespace at the start of each invocation. The
// canonical `performance_metrics` store keeps its `benchmarks: {}` field
// empty on this path — readers of historical benchmarks have no contract
// to honour, and won't, because none exists.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through
// which the volatile store may mutate. Direct `fs.writeFileSync` on the
// file from store-tree code is forbidden by the path-restricted
// substrate-internal.ts seam (ADR-0180 §Type enforcement).

import { registerMutationHandler } from '../../registration.js';
import type { MutationContext } from '../../mutation-context.js';
import type { GuardedWrite, StoreId } from '../../types.js';
import { benchmarkInvariants } from '../../invariants/performance/benchmark.js';

/** Per-suite benchmark result — shape mirrors the cli's `Benchmark`
 *  interface (performance-tools.ts:35-46). Retained verbatim so existing
 *  cli readers see no contract change once the dispatch path takes over. */
export interface BenchmarkRecord {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly results: {
    readonly duration: number;
    readonly iterations: number;
    readonly opsPerSecond: number;
    readonly memory: number;
  };
  readonly createdAt: string;
}

/** Volatile namespace contents — a single benchmark run keyed by suite
 *  name. `ephemeral: true` documents the overwrite-not-append contract for
 *  consumers reading the persisted document; there is no analogous flag in
 *  the on-disk schema, the field exists to make the namespace's lifecycle
 *  explicit at the wire level. */
export interface BenchmarkVolatileRecord {
  readonly ephemeral: true;
  readonly runId: string;
  readonly suite: string;
  readonly iterations: number;
  readonly warmup: boolean;
  readonly runAt: string;
  readonly results: Readonly<Record<string, BenchmarkRecord>>;
}

/** Mutation payload — the freshly-completed benchmark run to persist. The
 *  cli's handler executes the actual micro-benchmarks (`benchmarkFunctions`
 *  + `performance.now()` timing + `process.memoryUsage()` deltas) and
 *  passes the assembled record to this handler. Execution stays cli-side;
 *  this handler owns only the persistence step. */
export interface PerfBenchmarkPayload {
  readonly runId: string;
  readonly suite: string;
  readonly iterations: number;
  readonly warmup: boolean;
  readonly results: ReadonlyArray<BenchmarkRecord>;
}

const STORE_ID = 'performance_benchmark_volatile' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of performance-tools.ts
// `performance_benchmark` callsite (suite selection + warmup loop + timed
// iterations + memory-delta capture) once the dispatch boundary is wired
// through cli. Execution stays cli-side; the dispatch boundary at this
// handler owns persistence only — the suite-execution loop is not a
// substrate concern.
//
// Note (Open Follow-up #14 Site 2): historical "vsPrevious" comparison
// reporting in performance-tools.ts:344-354 reads `store.benchmarks` for
// cross-run trend lines. That comparison can no longer be served from this
// store (overwrite-not-append). Once cli wire-up lands, the comparison
// either drops (preferred — fork-permanence leak removed) or moves to a
// caller-side rolling cache keyed on the in-process performance_report
// history (./report.ts), not on benchmark output.
export const performanceBenchmarkHandler: GuardedWrite<PerfBenchmarkPayload> =
  registerMutationHandler<PerfBenchmarkPayload>(
    'performance_benchmark',
    async (ctx: MutationContext<false>, payload: PerfBenchmarkPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        // Overwrite-not-append: assemble a fresh `results` map from this run
        // only. Prior contents of `STORE_ID/root` are intentionally discarded
        // — the substrate's `handle.write` replaces the value at the key,
        // which is the auto-clear semantic for this namespace.
        const resultsByName: Record<string, BenchmarkRecord> = {};
        for (const result of payload.results) {
          resultsByName[result.name] = result;
        }

        const next: BenchmarkVolatileRecord = {
          ephemeral: true,
          runId: payload.runId,
          suite: payload.suite,
          iterations: payload.iterations,
          warmup: payload.warmup,
          runAt: new Date().toISOString(),
          results: resultsByName,
        };

        await handle.write({ storeId: STORE_ID, key: 'root', payload: next });
      });
    },
    {
      invariants: benchmarkInvariants,
      cacheScope: 'store',
    },
  );
