// charter: dispatch
// `hook_session_end` handler — replaces `intelligence.cjs#consolidate` as the
// session-end caller (ADR-0180 Open Follow-up #11, audit 2026-05-14).
//
// Disposition summary (ADR-0180 §Open Follow-up #11):
//   - Winner of the two parallel consolidation systems is the worker-daemon
//     `runConsolidateWorker` (out-of-process, archivist-aligned via
//     `routeLearningOp 'consolidate'`).
//   - `intelligence.cjs:consolidate()` is retired as a session-end caller; its
//     `.claude-flow/data/{graph-state,ranked-context,intelligence-snapshot}.json`
//     writers move under the daemon's archivist handler.
//   - The session-end hook becomes a no-op pointer that NUDGES the daemon to
//     schedule a consolidation pass. No data is written from the hook's stack.
//
// Nudge mechanism (per #11 disposition, "Nudge mechanism — concrete spec",
// HIGH → resolved):
//   - Reuses the existing daemon Unix-domain-socket IPC (`daemon-ipc.ts` +
//     `.claude-flow/daemon.sock`, owner-only mode 0600).
//   - Wire format: newline-delimited JSON-RPC 2.0 (matching `daemon-ipc.ts`
//     `JsonRpcRequest` contract — `{jsonrpc: '2.0', method, params, id}`).
//   - Logical request shape (as carried in `method` + `params`):
//
//         { op: "consolidate.schedule",
//           reason: "session-end",
//           sessionId: <string|null>,
//           ts: <epoch-ms> }
//
//     On the wire this is encoded as a JSON-RPC 2.0 call:
//
//         { "jsonrpc": "2.0",
//           "method": "consolidate.schedule",
//           "params": { "reason": "session-end",
//                       "sessionId": "<string|null>",
//                       "ts": <epoch-ms> },
//           "id": <correlation-id> }
//
//   - The daemon ACKs (JSON-RPC `result`) by enqueueing the pass at the next
//     worker tick (≤250ms). The hook never blocks on consolidation completion.
//   - If the daemon socket is absent (daemon not running): the handler logs
//     WARN `"daemon socket unreachable; consolidation will run at next daemon
//     start"` and returns SUCCESS — no silent loss per
//     `feedback-no-fallbacks.md`. The audit entry is the durable record; the
//     daemon's recovery scan re-enqueues on next start (bounds spec below).
//
// Recovery-scan bounds (per #11 disposition, "Recovery-scan bounds — concrete
// spec", MEDIUM → resolved):
//   (a) Scan window: last 7 days of audit entries (laptop-sleep + weekend gap
//       coverage; stale session-end events older than 7d are skipped silently
//       — low marginal value).
//   (b) Dedup: keyed by `sessionId` in the daemon's in-memory pending set;
//       skips re-enqueue if the sessionId is already enqueued OR has a paired
//       `consolidation.applied` audit entry within the scan window
//       (idempotent).
//   (c) Queue-depth cap: hard cap 50 entries; if the recovery scan finds >50
//       unpaired `session-end` entries the daemon enqueues the 50 most-recent
//       and logs WARN `"recovery scan capped at 50; older unpaired session-end
//       events skipped"` — prevents startup queue blowup.
//   (d) Scan cost: O(N) where N = audit entries in the 7-day window;
//       sub-second on expected workload (~10–50 session-ends/week + a few
//       hundred mutation entries).
//   (e) Test gate: `test/acceptance/consolidation-recovery.test.ts` (F7-tests
//       follow-up) seeds an audit log with 60 unpaired session-end events,
//       starts the daemon, asserts the daemon enqueues exactly 50, applies
//       them, and logs the cap-WARN. Companion gate
//       `test/acceptance/consolidation-nudge.test.ts` exercises the happy path
//       (IPC arrival ≤50ms, worker invocation ≤500ms, audit chain witnesses
//       the `consolidation.applied` parent-link to this handler's audit
//       entry).
//
// Cold-path discipline (ADR-0180 §Performance and hot paths):
//   - `session-end` is COLD-but-heavy work — registered WITHOUT `hotPath: true`
//     so the full audit chain (intent → applied | rejected) and substrate-
//     mutation envelope apply. The actual work is dispatched out-of-process to
//     the daemon; the audit entry's purpose is to be the recoverable witness
//     the daemon's start-time scan reads.
//   - No `child()` / `bulk()` calls — this handler is a single leaf intent.
//
// Deferral note (F4-3): `forks/ruflo/v3/@claude-flow/cli/.claude/helpers/
// intelligence.cjs#consolidate` and the cli's session-end hook plumbing are
// NOT edited by this migration. The cli stays authoritative until the
// dispatch surface lands. This file establishes the registration shape the
// dispatch path will resolve once F4-3 wires `intelligence.cjs` to call into
// the archivist instead of doing its own in-process consolidation.
//
// IPC wiring (F4-2 Phase B — live): the live nudge is a minimal newline-
// delimited JSON-RPC 2.0 client written inline below. `daemon-ipc.ts` removed
// its client class in ADR-0088 (zero in-tree callers at the time); the server
// side (`DaemonIPCServer`, line-framed reader at daemon-ipc.ts:144-160) is the
// contract this client targets. The audit entry written by the cold-path
// dispatch envelope remains the durable witness — the IPC nudge only buys the
// ≤250ms-ACK latency over next-daemon-start; on socket-absent the recovery
// scan re-enqueues from the audit log.

import { createConnection } from 'node:net';
import * as path from 'node:path';
import { registerMutationHandler } from '../../registration.js';
import type { StoreId } from '../../types.js';
import { sessionEndInvariants } from '../../invariants/hooks/session-end.js';

/** Tight connect+send budget for the nudge — the hook must not stall session
 *  teardown waiting on a daemon that may be slow or gone. On timeout the
 *  handler falls through to the WARN + recovery-scan path. */
const NUDGE_TIMEOUT_MS = 50;

/**
 * Minimal one-shot JSON-RPC 2.0 client for the daemon consolidation nudge.
 * Resolves `true` when the daemon ACKs (any JSON-RPC `result`), `false` on
 * connect failure (ENOENT / ECONNREFUSED — daemon not running) or timeout.
 * Never throws: a failed nudge is not a failed session-end (the audit entry is
 * the durable record; `feedback-no-fallbacks` is satisfied because the failure
 * is surfaced as a WARN, not swallowed silently).
 */
function sendConsolidateNudge(
  socketPath: string,
  request: Record<string, unknown>,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // socket already torn down — nothing to clean up.
      }
      resolve(ok);
    };

    const socket = createConnection(socketPath);
    socket.setTimeout(NUDGE_TIMEOUT_MS);

    let buffer = '';
    socket.on('connect', () => {
      socket.write(JSON.stringify(request) + '\n');
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx === -1) return;
      const line = buffer.slice(0, newlineIdx).trim();
      try {
        const resp = JSON.parse(line) as { result?: unknown; error?: unknown };
        // ACK = any well-formed JSON-RPC response carrying `result`. An `error`
        // response (method not found on an older daemon) is treated as a failed
        // nudge — the recovery scan covers it.
        finish(Object.prototype.hasOwnProperty.call(resp, 'result'));
      } catch {
        finish(false);
      }
    });
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
  });
}

/**
 * `hook_session_end` payload — what the cli's session-end hook delivers to the
 * archivist when the user's Claude Code session ends. Shape mirrors the
 * `intelligence.cjs#consolidate` invocation site's available context.
 */
export interface SessionEndPayload {
  readonly sessionId: string | null;
  readonly timestamp: number;
  readonly reason: 'session-end';
}

const STORE_ID = 'hooks_session_end' as StoreId;

export const sessionEndHandler = registerMutationHandler<SessionEndPayload>(
  'hook_session_end',
  async (ctx, payload) => {
    // Single leaf intent — no child(), no bulk(). Two-part body:
    //   (1) Record the session-end entry to the FS-JSON substrate. This is the
    //       durable witness the daemon's start-time recovery scan reads (per
    //       disposition (a)-(e) above) — it MUST land before the nudge so a
    //       crash between write and nudge still leaves a recoverable record.
    //   (2) Send the live IPC nudge so a running daemon enqueues immediately
    //       (≤250ms ACK) rather than waiting for its next-start recovery scan.
    await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
      await handle.write({
        storeId: STORE_ID,
        key: `${payload.timestamp}:${payload.sessionId ?? 'unknown'}`,
        payload,
      });
    });

    // ADR-0180 F4-2 Phase C: `ctx.projectRoot` is the resolved project root the
    // archivist threads onto every context — the SAME value the substrate layer
    // uses for FS-JSON paths (`ArchivistInitConfig.projectRoot ?? process.cwd()`).
    // The daemon socket lives under that root, so a non-cwd project root now
    // reaches IPC consumers, not just substrate paths. (Earlier `TODO(F4-2-config)`
    // resolved — `MutationContext` carried no `projectRoot`; it does now.)
    const socketPath = path.join(ctx.projectRoot, '.claude-flow', 'daemon.sock');

    // Logical request shape `{op:"consolidate.schedule",reason,sessionId,ts}`
    // encoded as JSON-RPC 2.0 per the file-header wire spec. `id` = the audit
    // id so the daemon's ACK correlates back to this handler's audit entry.
    const request = {
      jsonrpc: '2.0' as const,
      method: 'consolidate.schedule',
      params: {
        reason: payload.reason,
        sessionId: payload.sessionId,
        ts: payload.timestamp,
      },
      id: ctx.auditId,
    };

    const acked = await sendConsolidateNudge(socketPath, request);
    if (!acked) {
      // Daemon not running / unreachable / pre-nudge-method daemon. NOT an
      // error: the substrate entry above + the dispatch envelope's audit entry
      // are the durable record, and the daemon's recovery scan re-enqueues
      // unpaired session-end events on its next start (disposition (a)-(e)).
      // `feedback-no-fallbacks` is honored — the degraded path is surfaced as
      // a WARN, never a silent no-op.
      // eslint-disable-next-line no-console
      console.warn(
        'archivist[hook_session_end]: daemon socket unreachable; ' +
          'consolidation will run at next daemon start',
      );
    }
  },
  {
    invariants: sessionEndInvariants,
    cacheScope: 'global',
  },
);
