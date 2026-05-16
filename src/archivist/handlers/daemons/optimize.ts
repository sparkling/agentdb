// charter: substrate-seam
// daemon_runOptimize mutation handler (ADR-0180 Phase 7 §Architecture · Audit
// chain). Registers the 60-minute scheduled `optimize` worker write as a
// `GuardedWrite<OptimizeWorkerPayload>` so each performance-metrics snapshot
// transition flows through the archivist's audit-chain (intent → applied |
// rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing daemon callsite: `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts`
// `runOptimizeWorkerLocal` method (line 1378), reached via the scheduler entry
// `{ type: 'optimize', intervalMs: 60 * 60 * 1000, ... }` (line 109) and the
// dispatch switch at line 1241. The worker writes
// `.claude-flow/metrics/performance.json` via `writeFileSync` — under
// ADR-0180 F4-3 the daemon callsite stays in place; this file establishes the
// registration shape the dispatch path will resolve once wired.
//
// F4-3 deferral: dispatch wiring stays out of this patch. The daemon continues
// to invoke `runOptimizeWorkerLocal` directly from the switch at line 1241;
// only the archivist registration shape lands here. When the dispatch boundary
// is threaded through (Phase 7+ wire-up), the local body becomes
// `archivist.dispatchMutation('daemon_runOptimize', {})` and the cli callsite
// retires.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/metrics/performance.json` may mutate. The underlying
// primitive is `makeFsJsonSubstrate` (substrates/fs-json-store.ts), shared
// across daemon worker writes under one cross-process O_EXCL sentinel lock.
// Cold-path: 60-minute scheduler cadence means contention is negligible and
// `cacheScope: 'global'` (rather than namespace-bucketed) is the correct
// granularity — there is no caller-supplied key to scope against.

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';
import { optimizeInvariants } from '../../invariants/daemons/optimize.js';

/**
 * Mutation payload for the daemon-scheduled performance-optimize worker.
 *
 * The cli's `runOptimizeWorkerLocal` (worker-daemon.ts:1378-1401) composes
 * its snapshot from `process.memoryUsage()` / `process.uptime()` reads — those
 * are in-process probes the *daemon* performs on its own stack and are NOT a
 * substrate concern (matches the `performance/benchmark.ts` precedent: the cli
 * runs the work, the handler owns persistence only). So the snapshot arrives
 * here fully-composed in the payload; the handler writes it verbatim.
 *
 * The field set mirrors the cli snapshot 1:1 so the on-disk
 * `.claude-flow/metrics/performance.json` schema is unchanged when the F4-3
 * dispatch wire-up flips `runOptimizeWorkerLocal` to
 * `archivist.dispatch('daemon_runOptimize', snapshot)`.
 */
export interface OptimizeWorkerPayload {
  /** ISO-8601 — `new Date().toISOString()` at the daemon tick. */
  readonly timestamp: string;
  /** `'local'` (process-probe fallback) or `'headless'` (CLI-assisted run). */
  readonly mode: 'local' | 'headless';
  /** `process.memoryUsage()` snapshot composed daemon-side. */
  readonly memoryUsage: NodeJS.MemoryUsage;
  /** `process.uptime()` seconds composed daemon-side. */
  readonly uptime: number;
  /** Optimization metrics — cli literals today; real values once headless lands. */
  readonly optimizations: {
    readonly cacheHitRate: number;
    readonly avgResponseTime: number;
  };
  /** Operator-facing note (cli ships an "install Claude Code CLI" hint). */
  readonly note: string;
}

const STORE_ID = 'metrics_performance' as StoreId;

// F4-2 body: the snapshot is composed daemon-side (process probes are not a
// substrate concern — `performance/benchmark.ts` precedent) and arrives in the
// payload; this handler owns persistence only. One `withWrite` scope → one
// `handle.write` of the whole document. The cli `writeFileSync(.../performance.json)`
// at worker-daemon.ts:1399 collapses to this call once F4-3 flips the daemon
// switch to `archivist.dispatch('daemon_runOptimize', snapshot)`.
export const optimizeWorkerHandler: GuardedWrite<OptimizeWorkerPayload> =
  registerMutationHandler<OptimizeWorkerPayload>(
    'daemon_runOptimize',
    async (ctx: MutationContext<false>, payload: OptimizeWorkerPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        await handle.write({ storeId: STORE_ID, key: 'root', payload });
      });
    },
    {
      invariants: optimizeInvariants,
      cacheScope: 'global',
    },
  );
