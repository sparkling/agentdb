// charter: substrate-seam
// daemon_runConsolidate mutation handler (ADR-0180 Phase 7 §Architecture · Daemons,
// Open Follow-up #11 WINNER). This file owns the canonical POST-Phase-7
// consolidation surface per the #11 disposition: worker-daemon
// `runConsolidateWorker` was picked over the in-process
// `intelligence.cjs:consolidate()` session-end caller because the daemon
// path already routes through `routeLearningOp 'consolidate'` (the supported
// ADR-0084 Phase 3 surface) and the substrate's O_EXCL sentinel lock gives
// the archivist's audit chain single-writer semantics that the parallel
// in-process implementation could not.
//
// ── #11 disposition WINNER — owns FOUR output files post-Phase-7 ──
//   1. `.claude-flow/metrics/consolidation.json` — existing daemon-side
//      summary file (worker-daemon.ts:1448) with `patternsConsolidated`,
//      `memoryCleaned`, `duplicatesRemoved`, `hnswRebuilt`,
//      `routerConsolidated`, `timestamp` fields.
//   2. `.claude-flow/data/graph-state.json` — currently written by
//      `intelligence.cjs:consolidate()` step 6 (intelligence.cjs:816-823):
//      `{ version, updatedAt, nodeCount, nodes, edges, pageRanks }`. Post-#11
//      migration, this handler owns the writer.
//   3. `.claude-flow/data/ranked-context.json` — currently written by
//      `intelligence.cjs:consolidate()` step 7 (intelligence.cjs:847-851):
//      `{ version, computedAt, entries[] }` with PageRank+confidence-sorted
//      store entries. Post-#11 migration, this handler owns the writer.
//   4. `.claude-flow/data/intelligence-snapshot.json` — currently written by
//      `intelligence.cjs:saveSnapshot()` via step 10 of consolidate()
//      (intelligence.cjs:880-882, 897-onwards): delta-tracking snapshot for
//      hooks. Post-#11 migration, this handler owns the writer.
//
// Source bodies the handler will EVENTUALLY adopt:
// - `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:1403-1453`
//   `runConsolidateWorker()` — out-of-process daemon-scheduled (10–60min
//   cadence per ADR-0180 §Architecture Daemons); ensures `metrics/`,
//   queries `routeEmbeddingOp 'hnswStatus'` for reporting, invokes
//   `routeLearningOp 'consolidate'` (ADR-0084 Phase 3 path), writes summary.
// - `forks/ruflo/v3/@claude-flow/cli/.claude/helpers/intelligence.cjs:717-891`
//   `consolidate()` — in-process body the disposition says to PORT TO
//   TYPESCRIPT and invoke from the daemon's runConsolidateWorker AFTER
//   `routeLearningOp 'consolidate'` returns: dedup-by-ID (intelligence.cjs:728),
//   pending-insight promotion at 3+ edits (intelligence.cjs:730-768),
//   confidence decay 0.005/day for unaccessed entries >24h (intelligence.cjs:770-781),
//   edge rebuild + node assembly (intelligence.cjs:783-803),
//   PageRank d=0.85 30-iter (intelligence.cjs:805-813),
//   ranked-context derivation 0.6·pageRank+0.4·confidence (intelligence.cjs:826-851),
//   30-day eviction + 1000-entry cap (intelligence.cjs:853-877),
//   snapshot for delta tracking (intelligence.cjs:879-882). ~175 LoC.
//
// SCOPE: this file ships the registration shape only. The body is a Phase 4-2
// throw-stub. Worker-daemon callsite stays in place; `intelligence.cjs:consolidate()`
// stays in place. Both will be retired in the F4-3 body-migration follow-up
// (consolidate body ported to TS + daemon's runConsolidateWorker switched to
// dispatch `daemon_runConsolidate` + session-end hook switched from in-process
// invocation to IPC nudge `{op: 'consolidate.schedule'}`).
//
// ── Recovery-scan bounds (per #11) ──
// Daemon-side recovery semantics (validated by the planned
// `test/acceptance/consolidation-recovery.test.ts` gate):
//   - Audit window: 7-day scan over the archivist audit chain looking for
//     `session-end` hook entries WITHOUT a downstream `consolidation.applied`
//     entry whose `parentAuditId` chains back. Older entries are considered
//     stale and skipped.
//   - Queue cap: at most 50 pending consolidation intents in the recovery
//     enqueue at any time. Excess intents drop oldest-first (drop is itself
//     audited as `consolidation.skipped` with `reason: 'queue-cap'`).
//   - Dedup by sessionId: multiple `session-end` entries from the same
//     `sessionId` within the 7-day window collapse to a single enqueued
//     `daemon_runConsolidate` intent. Sessions without `sessionId` (scheduled
//     ticks) never dedup with each other but DO supersede pending
//     session-end-nudge intents during their flush.
// These bounds protect against (a) unbounded backlog after a long daemon
// outage, (b) repeated nudge spam from a chatty hook, and (c) test-environment
// fixtures replaying old audit entries.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// consolidation artifacts may mutate. Direct fs writes are forbidden by the
// `no-restricted-imports` backstop and the path-restricted
// substrate-internal.ts seam (ADR-0180 §Type enforcement). The four output
// files above are written under ONE `ctx.substrate.withWrite` block (single
// intent / multi-file atomic write — see TODO(F4-2) below) so the audit
// chain records a single `consolidation.applied` entry covering all four
// artifacts, not four separate intents.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/**
 * Mutation payload for daemon-scheduled consolidation passes (ADR-0180
 * Open Follow-up #11 nudge mechanism).
 *
 * `reason` discriminates the two callers:
 *   - `'scheduled'` — daemon's 10–60min cadence tick (worker-daemon side).
 *     `sessionId` is absent; `ts` is the daemon's tick timestamp.
 *   - `'session-end-nudge'` — IPC nudge from `hook_session_end`
 *     (`{op: 'consolidate.schedule'}`). `sessionId` MUST be present so the
 *     daemon's recovery-dedup can collapse repeat nudges for the same
 *     session within the 7-day window; `ts` is the hook's emit timestamp.
 *
 * `ts` is REQUIRED on both paths so the recovery scan's 7-day window has a
 * deterministic boundary independent of audit-chain wall-clock.
 */
export interface ConsolidateWorkerPayload {
  readonly reason: 'scheduled' | 'session-end-nudge';
  readonly sessionId?: string;
  readonly ts: number;
  /**
   * The consolidation summary, computed daemon-side. The cli's
   * `runConsolidateWorker` (worker-daemon.ts:1403-1450) runs the actual pass —
   * `routeEmbeddingOp 'hnswStatus'` probe + `routeLearningOp 'consolidate'`
   * invocation (ADR-0084 Phase 3 path) — and the `intelligence.cjs:consolidate()`
   * body runs the dedup / PageRank / eviction pipeline. Per the
   * `performance/benchmark.ts` precedent the *execution* stays caller-side; the
   * handler owns persistence only. The summary therefore arrives here
   * fully-composed. Field set mirrors `runConsolidateWorker`'s `result` object
   * (worker-daemon.ts:1411-1428) 1:1 so the on-disk
   * `.claude-flow/metrics/consolidation.json` schema is unchanged when F4-3
   * flips the daemon switch.
   */
  readonly summary: ConsolidationSummary;
}

/**
 * Daemon-side consolidation summary — mirrors the `result` object assembled in
 * `worker-daemon.ts` `runConsolidateWorker` (lines 1411-1428). `timestamp` is
 * the worker's `new Date().toISOString()`; the count fields are populated by
 * the `routeLearningOp 'consolidate'` round-trip; `routerConsolidated` records
 * whether that round-trip reported success.
 */
export interface ConsolidationSummary {
  readonly timestamp: string;
  readonly patternsConsolidated: number;
  readonly memoryCleaned: number;
  readonly duplicatesRemoved: number;
  /** `routeEmbeddingOp 'hnswStatus'` `totalEntries` — `0` when status unavailable. */
  readonly hnswRebuilt?: number;
  /** `routeLearningOp 'consolidate'` `success` flag. */
  readonly routerConsolidated?: boolean;
}

const STORE_ID = 'daemon_runConsolidate' as StoreId;

// F4-2 body: persists the daemon-side consolidation summary to
// `.claude-flow/metrics/consolidation.json` (the path `daemon_runConsolidate`
// resolves to via `FS_JSON_PATH_OVERRIDES`). The consolidation *computation*
// (hnswStatus probe + `routeLearningOp 'consolidate'` + the intelligence.cjs
// pipeline) stays caller-side per the `performance/benchmark.ts` precedent —
// the handler owns persistence only. One `withWrite` scope → one `handle.write`
// of the summary document. The cli `writeFileSync(.../consolidation.json)` at
// worker-daemon.ts:1448 collapses to this call once F4-3 flips the daemon
// switch to `archivist.dispatch('daemon_runConsolidate', { reason, ts, summary })`.
//
// TODO(F4-2-config: substrate-registry routing for the OF#11 sibling artifacts):
// ADR-0180 Open Follow-up #11 makes this handler the post-Phase-7 owner of FOUR
// files — `metrics/consolidation.json` (handled here) PLUS
// `data/graph-state.json`, `data/ranked-context.json`, and
// `data/intelligence-snapshot.json`. The other three CANNOT be written from
// this handler yet: `substrate-registry.ts` `FS_JSON_PATH_OVERRIDES`
// (lines 144-174) routes no `StoreId` to `data/graph-state.json` or
// `data/ranked-context.json` (only `hooks_pre_task`/`hooks_session_end` route
// to `data/intelligence-snapshot.json`, and those are owned by the hooks
// handlers). Wiring those three is `initialize(config)`-adjacent registry work
// — three new `FS_JSON_PATH_OVERRIDES` entries (e.g. `consolidate_graph_state`
// → `data/graph-state.json`, `consolidate_ranked_context` →
// `data/ranked-context.json`, and a snapshot-ownership transfer) — not
// something this handler can fake. Each FS-JSON store is a distinct file +
// O_EXCL lock (`makeFsJsonSubstrate` is per-path), so the OF#11 "single
// `consolidation.applied` entry covering all four artifacts" lands once those
// storeIds exist and the four writes can be sequenced under one cold-path
// `ctx.child()` audit tree. Until then this handler writes the one file it has
// a registry route for; the other three stay with `intelligence.cjs:consolidate()`
// per the F4-3 deferral. No silent half-write — the gap is documented, not masked
// (`feedback-no-fallbacks`).
export const consolidateDaemonHandler: GuardedWrite<ConsolidateWorkerPayload> =
  registerMutationHandler<ConsolidateWorkerPayload>(
    'daemon_runConsolidate',
    async (ctx: MutationContext<false>, payload: ConsolidateWorkerPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        await handle.write({ storeId: STORE_ID, key: 'root', payload: payload.summary });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
