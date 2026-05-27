// charter: workers
// Graph-edge sweep worker — ADR-0261 §R2.2 / §R2.10. Background-only retention
// GC: every tick, dispatches `agentdb_graph_edge { action: 'sweep-internal' }`
// with `maxAgeDays` from config-chain. Per-tick substrate acquisition; NO
// module-scope substrate handle cache (ADR-0202 / ADR-0246 / ADR-0253 C2).
//
// NOT exposed as an MCP tool. Producers / agents never see this code path —
// it's purely operational. The MCP surface for graph-edges is the 2 read
// tools (`agentdb_graph-query`, `agentdb_graph-pathfinder`) per §R2.1; this
// worker is the "graph that doesn't ALSO grow unbounded" mitigation per §R2.2.
//
// Cadence + threshold come from config-chain — no hardcoded 90 / 0.01 / 64
// (acceptance gate C4). Default cadence is `0 3 * * *` (nightly 3am local).
//
// The worker does not implement a cron parser inline — it exposes a single
// tick fn (`runSweepOnce`) and a lifecycle pair (`startGraphEdgeSweepWorker`
// / `stopGraphEdgeSweepWorker`) using `setTimeout` with the next-tick delay
// computed from the cadence. The fork's existing daemon scheduler can also
// invoke `runSweepOnce` directly without going through the lifecycle pair.

import { getGraphEdgesConfig } from '../encoders/scalar-int8-encoder.js';
import type { AgentdbGraphEdgeSweepInternalPayload } from '../archivist/handlers/agentdb/graph-edge.js';

/**
 * Narrow dispatch surface. Matches the producer files' shape so callers can
 * share a single bound `archivist.dispatch.bind(archivist)`.
 */
export type SweepDispatcher = (
  tool: 'agentdb_graph_edge',
  payload: AgentdbGraphEdgeSweepInternalPayload,
) => Promise<unknown>;

/**
 * Run a single sweep tick. Reads `maxAgeDays` from config-chain (default 90),
 * dispatches once, returns. Throws on dispatch failure — sweep failures are
 * not silently squelched (`feedback-no-fallbacks`).
 *
 * Per ADR-0202 / ADR-0253 C2: this fn acquires the substrate handle PER TICK
 * via the archivist dispatch path. It holds no handle across ticks (no
 * module-scope cache; no closure over a connection). Re-invoking is the
 * acquire-release boundary.
 */
export async function runSweepOnce(dispatcher: SweepDispatcher): Promise<void> {
  const cfg = getGraphEdgesConfig();
  await dispatcher('agentdb_graph_edge', {
    action: 'sweep-internal',
    maxAgeDays: cfg.sweep.maxAgeDays,
  });
}

// ─── Lifecycle helper ────────────────────────────────────────────────────────
//
// Minimal cron-stub: this worker is invoked by the fork's daemon scheduler in
// production; the lifecycle helpers below are for use cases (tests, embedded
// runs) where a self-scheduling worker is the cheapest path. The cadence
// parser here is intentionally limited to the common "every N hours" and
// "every N minutes" shapes — full cron syntax is the daemon's job. If the
// cadence string is full cron and not one of the recognized shapes, the
// helper falls back to a 60-minute interval and logs a notice; daemon-driven
// invocations bypass this entirely.
//
// `setTimeout` (not `setInterval`) so a slow tick can't queue concurrent
// invocations — the next setTimeout schedule happens after the current tick
// finishes (drift-tolerant).

let activeHandle: NodeJS.Timeout | null = null;

function parseCadenceMillis(cadence: string): number {
  // Recognized shapes:
  //   '0 N * * *'    → every day at hour N (24h)
  //   '0 */N * * *'  → every N hours
  //   '*/N * * * *'  → every N minutes
  const dailyHour = cadence.match(/^0\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (dailyHour) return 24 * 60 * 60 * 1000;
  const everyNHours = cadence.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (everyNHours) {
    const n = Number(everyNHours[1]);
    if (n > 0) return n * 60 * 60 * 1000;
  }
  const everyNMinutes = cadence.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (everyNMinutes) {
    const n = Number(everyNMinutes[1]);
    if (n > 0) return n * 60 * 1000;
  }
  process.stderr.write(
    `[graph-edge-sweep] unrecognized cadence "${cadence}"; falling back to 60min interval\n`,
  );
  return 60 * 60 * 1000;
}

/**
 * Start the self-scheduling sweep worker. Idempotent — re-calling is a no-op
 * until `stopGraphEdgeSweepWorker` is called. Returns a handle for tests to
 * await one full tick if needed.
 */
export function startGraphEdgeSweepWorker(dispatcher: SweepDispatcher): { stop: () => void } {
  if (activeHandle !== null) {
    return { stop: stopGraphEdgeSweepWorker };
  }
  const cfg = getGraphEdgesConfig();
  const intervalMs = parseCadenceMillis(cfg.sweep.cadence);
  const tick = async (): Promise<void> => {
    try {
      await runSweepOnce(dispatcher);
    } catch (err) {
      // Errors must propagate so the daemon's supervisor sees the failure.
      // We re-throw via an unhandled rejection so the surrounding host can
      // observe it — silent catch would violate `feedback-best-effort-must-
      // rethrow-fatals`.
      process.stderr.write(
        `[graph-edge-sweep] tick failed: ${String((err as Error)?.message ?? err)}\n`,
      );
      // Re-throw so the lifecycle helper's caller (or any wrapping promise)
      // can see the failure. setTimeout swallows thrown errors silently
      // unless we explicitly schedule them as a rejected microtask.
      Promise.reject(err as Error);
    } finally {
      // Schedule the next tick AFTER the current one completes. Drift-
      // tolerant: a long tick simply pushes the next one out.
      if (activeHandle !== null) {
        activeHandle = setTimeout(() => {
          void tick();
        }, intervalMs);
      }
    }
  };
  activeHandle = setTimeout(() => {
    void tick();
  }, intervalMs);
  return { stop: stopGraphEdgeSweepWorker };
}

/** Stop the worker. No-op if already stopped. */
export function stopGraphEdgeSweepWorker(): void {
  if (activeHandle !== null) {
    clearTimeout(activeHandle);
    activeHandle = null;
  }
}
