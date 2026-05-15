// charter: dispatch
// Shared types + orphan reconciliation for swarm_* handlers (ADR-0180 Phase 5).
// Mirrors `cli/src/mcp-tools/swarm-tools.ts:29-125` `SwarmState` / `SwarmStore`
// shapes and the #1799 orphan-reconciliation logic verbatim so the dispatch
// boundary can read/write the same on-disk `.swarm/swarm-state.json` without
// a schema migration. The cli's interface declarations stay in place until
// Phase 7+ removes the legacy callsites; until then both surfaces share the
// same JSON document.

export interface SwarmState {
  swarmId: string;
  topology: string;
  maxAgents: number;
  status: 'initializing' | 'running' | 'paused' | 'shutting_down' | 'terminated';
  agents: string[];
  tasks: string[];
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** #1799 — process that initialized this swarm. Used by reconciliation to
   *  detect orphan entries whose host process has already exited. Optional for
   *  back-compat with pre-#1799 stores. */
  pid?: number;
  /** Reason set when status was forced to 'terminated' by reconciliation. */
  terminationReason?: string;
}

export interface SwarmStore {
  swarms: Record<string, SwarmState>;
  version: string;
}

/**
 * #1799 — true when `pid` belongs to a live process. `process.kill(pid, 0)`
 * with signal 0 is the documented liveness probe: ESRCH ⇒ dead, EPERM ⇒ alive
 * but owned by another user (still alive — don't reap), success ⇒ alive.
 * Ported verbatim from swarm-tools.ts:78-85.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * #1799 — walk swarms with status='running' and mark orphans as 'terminated':
 *   - PID-based: `pid` set and the process is dead ⇒ orphan.
 *   - TTL fallback: pre-#1799 entries (no `pid`) reaped when `updatedAt` is
 *     older than 24h.
 * Mutates `store` in place; returns the count for the caller to decide whether
 * to persist. Ported verbatim from swarm-tools.ts:100-125.
 */
export function reconcileOrphanSwarms(store: SwarmStore): number {
  let reconciled = 0;
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  for (const swarm of Object.values(store.swarms)) {
    if (swarm.status !== 'running') continue;
    let orphanReason: string | null = null;
    if (typeof swarm.pid === 'number') {
      if (!isPidAlive(swarm.pid)) {
        orphanReason = `host process ${swarm.pid} exited`;
      }
    } else {
      const ageMs = nowMs - new Date(swarm.updatedAt).getTime();
      if (Number.isFinite(ageMs) && ageMs > ORPHAN_TTL_MS) {
        orphanReason = `no pid recorded and heartbeat is ${Math.round(ageMs / 3600000)}h stale`;
      }
    }
    if (orphanReason) {
      swarm.status = 'terminated';
      swarm.terminationReason = orphanReason;
      swarm.updatedAt = nowIso;
      reconciled++;
    }
  }
  return reconciled;
}
