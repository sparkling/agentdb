// charter: substrate-seam
// daemon_runBenchmark mutation handler (ADR-0180 Phase 7 §Architecture · Audit chain).
// Registers the 2-hour scheduled `benchmark` worker write as a
// `GuardedWrite<BenchmarkWorkerPayload>` so each performance-snapshot transition
// flows through the archivist's audit-chain (intent → applied | rejected) with
// guard verdicts + invariant verdicts recorded.
//
// Pre-existing daemon callsite: `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts`
// `runBenchmarkWorkerLocal` method (line 1545-1565), reached via the scheduler
// entry `{ type: 'benchmark', intervalMs: 2 * 60 * 60 * 1000, offsetMs: 0,
// priority: 'low', description: 'Performance benchmarking', enabled: false }`
// (line 117) and the dispatch switch at line 1257. The worker writes
// `.claude-flow/metrics/benchmark.json` via `writeFileSync`.
//
// Disabled today (worker-daemon's runBenchmarkWorker isn't wired into the
// polling schedule); handler registered for parity per Phase 7 brief so the
// dispatch surface is uniform when re-enabled. The scheduler row ships
// `enabled: false`, so dispatch is never reached at runtime — but the registry
// entry exists so charter-conformance + structural acceptance observe the full
// daemon_* surface and re-enabling the row (flip `enabled` to `true`) routes
// through the audit chain without a second migration.
//
// F4-3 deferral: per ADR-0180 §F4-3 the daemon callsites stay in place during
// Phase 7; only the registration shape lands here. The dispatch wire-up from
// `runBenchmarkWorkerLocal` → `archivist.dispatchMutation('daemon_runBenchmark',
// ...)` is deliberately deferred — this file establishes the registry-side
// contract the wire-up will resolve.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/metrics/benchmark.json` may mutate. The underlying primitive
// is `makeFsJsonSubstrate` (substrates/fs-json-store.ts), shared across daemon
// worker writes under one cross-process O_EXCL sentinel lock — this handler
// holds the substrate seam for the benchmark worker.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/**
 * Mutation payload for the daemon-scheduled benchmark worker.
 *
 * The cli's `runBenchmarkWorkerLocal` (worker-daemon.ts:1545-1565) composes a
 * `{ timestamp, mode, benchmarks: { memoryUsage, cpuUsage, uptime } }` snapshot
 * from `process.*()` reads — in-process probes the *daemon* runs on its own
 * stack, not a substrate concern (`performance/benchmark.ts` precedent: the cli
 * runs the work, the handler owns persistence). The snapshot therefore arrives
 * here fully-composed; the handler writes it verbatim.
 *
 * Field set mirrors the cli snapshot 1:1 so the on-disk
 * `.claude-flow/metrics/benchmark.json` schema is unchanged when the F4-3
 * wire-up flips `runBenchmarkWorkerLocal` to
 * `archivist.dispatch('daemon_runBenchmark', snapshot)`.
 */
export interface BenchmarkWorkerPayload {
  /** ISO-8601 — `new Date().toISOString()` at the daemon tick. */
  readonly timestamp: string;
  /** `'local'` (process-probe fallback) or `'headless'` (CLI-assisted run). */
  readonly mode: 'local' | 'headless';
  /** Process-probe snapshot composed daemon-side. */
  readonly benchmarks: {
    readonly memoryUsage: NodeJS.MemoryUsage;
    readonly cpuUsage: NodeJS.CpuUsage;
    readonly uptime: number;
  };
}

const STORE_ID = 'metrics_benchmark' as StoreId;

// F4-2 body: the snapshot is composed daemon-side (process probes are not a
// substrate concern — `performance/benchmark.ts` precedent) and arrives in the
// payload; this handler owns persistence only. One `withWrite` scope → one
// `handle.write` of the whole document. The cli `writeFileSync(.../benchmark.json)`
// at worker-daemon.ts:1563 collapses to this call once F4-3 flips the daemon
// switch to `archivist.dispatch('daemon_runBenchmark', snapshot)` AND
// re-enables the scheduler row (worker-daemon.ts:117 `enabled: false` → `true`).
export const benchmarkWorkerHandler: GuardedWrite<BenchmarkWorkerPayload> =
  registerMutationHandler<BenchmarkWorkerPayload>(
    'daemon_runBenchmark',
    async (ctx: MutationContext<false>, payload: BenchmarkWorkerPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        await handle.write({ storeId: STORE_ID, key: 'root', payload });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
