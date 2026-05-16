// charter: substrate-seam
// daemon_hooksLearning mutation handler (ADR-0180 Phase 7 §Architecture · Daemons).
// Registers the 60-second `HooksLearningDaemon` consolidation pass as a
// `GuardedWrite<HooksLearningPayload>` so each `reasoningBank.consolidate()`
// invocation flows through the archivist's audit-chain (intent → applied |
// rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing daemon callsite:
// `forks/ruflo/v3/@claude-flow/hooks/src/daemons/index.ts`
//   - `HooksLearningDaemon` class (line 410)
//   - Scheduler entry: `() => this.consolidate()` registered on the
//     `DaemonManager` (line 433) at `interval: 60000` (line 430) — invoked
//     by `setInterval` (line 91, daemon-manager.start).
//   - Body: `this.consolidate()` (line 463) calls `this.reasoningBank.consolidate()`
//     (line 469); error path at line 489 currently logs but does NOT propagate.
//   - Force-trigger entry point: `forceConsolidate()` (line 543) invokes the
//     same `consolidate()` method outside the periodic cadence.
//
// Under ADR-0180 F4-3 the daemon callsite stays in place; this file establishes
// the registration shape the dispatch path will resolve once wired. The actual
// daemon-side fail-loud cli fix is owned by the sibling `fail-loud-fixer`
// worker (Phase 7 §Architecture · `forks/ruflo/v3/@claude-flow/hooks/src/daemons/index.ts`
// `HooksLearningDaemon.start()` lines 440-448 — bare `try/catch` swallowing
// `reasoningBank` import failures).
//
// === ADR-0180 Open Follow-up #14 Site 3 — architectural intent ===
//
// Today: `HooksLearningDaemon.start()` (lines 440-448) catches `reasoningBank`
// dynamic-import failures with a bare `try/catch`, logs `console.warn`, and
// continues; `consolidate()` then early-returns when `this.reasoningBank` is
// null (line 464-466). Net effect: if `config.memory.agentdb.enableLearning`
// is `true` but the module fails to import (missing peer dep, broken build,
// path drift), the consolidation-driven learning pipeline silently stops
// running and the only signal is a single warn line on daemon start. Canonical
// `feedback-no-fallbacks.md` violation and the discriminator failure called
// out by `feedback-best-effort-must-rethrow-fatals.md`.
//
// Disposition (handler-registration architectural intent):
//
//   - `config.memory.agentdb.enableLearning === false` (explicit opt-out):
//     log-and-skip is correct at the daemon-side. Operator chose to disable;
//     degraded-but-correct. The handler is NOT invoked because the daemon's
//     interval timer never registers.
//   - `config.memory.agentdb.enableLearning === true` AND `reasoningBank`
//     imports successfully: daemon dispatches `daemon_hooksLearning` through
//     this handler on each periodic + force trigger. Normal path.
//   - `config.memory.agentdb.enableLearning === true` AND `reasoningBank`
//     import / initialization FAILS: the daemon's `start()` MUST raise a
//     fatal error rather than swallow it. The handler is NOT invoked because
//     the daemon never reached `running` state. The startup-time fail-loud
//     ensures the broken pipeline cannot masquerade as healthy.
//
// **Scope split (per Phase 7 sibling-worker boundary):**
//
//   - THIS file (`hooks-learning-daemon-migrator` owner): the handler's
//     archivist-side registration shape + this architectural-intent comment.
//     The handler itself does NOT discriminate on `enableLearning` config —
//     by the time the daemon reaches dispatch, the daemon has already
//     committed to the contract. No defensive config re-checks inside the
//     handler (those would mask a daemon-startup bug, the opposite of fail-loud).
//   - `forks/ruflo/v3/@claude-flow/hooks/src/daemons/index.ts` daemon-side
//     fix (`fail-loud-fixer` sibling owner): replace the bare `try/catch` in
//     `HooksLearningDaemon.start()` lines 440-448 with the discriminator above,
//     raising a fatal startup error in the configured-but-unloadable branch.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// reasoningbank consolidation state may mutate. The underlying primitive is
// shared with sibling daemon worker handlers under one cross-process O_EXCL
// sentinel lock (ADR-0180 §Type enforcement, substrate-internal.ts seam).

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';

/**
 * Mutation payload for the 60-second hooks-learning consolidation pass.
 *
 * `trigger` discriminates the two callsites that funnel into
 * `HooksLearningDaemon.consolidate()`:
 *   - `'periodic'` — the `DaemonManager.setInterval(..., 60000)` cadence
 *     fires (`hooks/src/daemons/index.ts` line 91, registered at line 433).
 *   - `'force'`    — `HooksLearningDaemon.forceConsolidate()` (line 543) is
 *     invoked explicitly, e.g. from a CLI surface or test fixture.
 *
 * `ts` carries the trigger's UTC millisecond timestamp so the audit chain
 * records "when the scheduler fired" independent of when the handler's
 * substrate write lands (the audit-writer's own `timestamp` reflects the
 * latter and may drift seconds behind under sentinel-lock contention).
 */
export interface HooksLearningPayload {
  readonly trigger: 'periodic' | 'force';
  readonly ts: number;
  /**
   * The consolidation result + accumulated stats, computed daemon-side. The
   * daemon's `HooksLearningDaemon.consolidate()` (hooks/src/daemons/index.ts
   * lines 472-503) holds the `reasoningBank` reference — loaded via dynamic
   * import in `start()` (line 446) — and invokes `reasoningBank.consolidate()`
   * + `reasoningBank.getStats()` ON ITS OWN STACK. `reasoningBank` is NOT a
   * substrate backend and `initialize(config)` does not thread it (see the
   * `TODO(F4-2-config)` below); per the `performance/benchmark.ts` precedent
   * the *invocation* stays daemon-side and the handler owns persistence only.
   * The result therefore arrives here fully-composed.
   */
  readonly result: HooksLearningResult;
}

/**
 * Hooks-learning consolidation result — mirrors what
 * `HooksLearningDaemon.consolidate()` (hooks/src/daemons/index.ts) computes per
 * tick. `run` is the single `reasoningBank.consolidate()` return value;
 * `accumulated` is the daemon's running `consolidationStats` object (line 418)
 * AFTER this tick is folded in; `patternsLearned` is the recomputed
 * `shortTermCount + longTermCount` from `reasoningBank.getStats()` (line 498).
 */
export interface HooksLearningResult {
  readonly run: {
    readonly patternsPromoted: number;
    readonly patternsPruned: number;
    readonly duplicatesRemoved: number;
  };
  readonly accumulated: {
    readonly totalRuns: number;
    readonly patternsPromoted: number;
    readonly patternsPruned: number;
    readonly duplicatesRemoved: number;
  };
  readonly patternsLearned: number;
  /** `new Date().toISOString()` of the consolidation tick (the daemon's `lastConsolidation`). */
  readonly consolidatedAt: string;
}

const STORE_ID = 'daemon_hooks_learning' as StoreId;

// F4-2 body: persists the daemon-side consolidation result to
// `.claude-flow/data/hooks-learning.json` (the path `daemon_hooks_learning`
// resolves to via `FS_JSON_PATH_OVERRIDES`). One `withWrite` scope → one
// `handle.write` of the result document. The daemon's
// `HooksLearningDaemon.consolidate()` switches to
// `archivist.dispatch('daemon_hooksLearning', { trigger, ts, result })` once
// F4-3 flips the dispatch wire-up; the daemon-side `console.log` on non-zero
// promoted/pruned counts (hooks/src/daemons/index.ts line 500) stays daemon-side
// — logging is not a mutation.
//
// Fail-loud is PRESERVED, not weakened: the configured-but-unloadable
// `reasoningBank` fail-loud already lives at the correct surface —
// `HooksLearningDaemon.start()` (hooks/src/daemons/index.ts lines 446-452)
// already `throw`s when the dynamic import / `initialize()` fails, with the
// "set memory.agentdb.enableLearning: false" hint (ADR-0180 Open Follow-up #14
// Site 3, `feedback-best-effort-must-rethrow-fatals`). The daemon never reaches
// dispatch in that branch, so this handler does NOT — and per its own §Scope-split
// charter MUST NOT — re-check `enableLearning`: a defensive re-check here would
// mask a daemon-startup bug, the opposite of fail-loud. By the time dispatch
// reaches this handler the daemon has already committed to the contract.
//
// TODO(F4-2-config: thread the daemon's reasoningBank handle, OR keep it
// daemon-side): the `reasoningBank.consolidate()` / `.getStats()` invocation is
// NOT in this handler because `reasoningBank` is an in-process object the
// *daemon* owns (dynamically imported in `HooksLearningDaemon.start()`), and
// `ArchivistInitConfig` (index.ts) threads only `sqliteDb` / `rvfBackend` /
// `projectRoot` — no `reasoningBank`. Two honest resolutions, both F4-3 scope:
// (a) the daemon keeps invoking `reasoningBank` on its own stack and passes the
// composed `result` in the dispatch payload (the shape above is built for
// exactly this — preferred, matches the `performance/benchmark.ts` "cli runs
// the work, handler persists" precedent); or (b) `ArchivistInitConfig` grows a
// `reasoningBank` field and the handler invokes it inside `withWrite`. (a) is
// the precedent-aligned default; faking a `reasoningBank` invocation here
// against a backend `initialize()` never wired would be the `don't-fake-bodies`
// violation the F4-2 brief calls out.
export const hooksLearningDaemonHandler: GuardedWrite<HooksLearningPayload> =
  registerMutationHandler<HooksLearningPayload>(
    'daemon_hooksLearning',
    async (ctx: MutationContext<false>, payload: HooksLearningPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        await handle.write({ storeId: STORE_ID, key: 'root', payload: payload.result });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
