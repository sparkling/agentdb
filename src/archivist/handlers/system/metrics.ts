// charter: dispatch
// system_metrics mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers as `GuardedWrite<SystemMetricsPayload>` so every metrics refresh
// transitions through the archivist's audit-chain (intent → applied | rejected)
// with guard verdicts + invariant verdicts recorded.
//
// Why a read-shaped cli surface registers as a MUTATION handler:
//   - The cli `system_metrics` handler returns the current metrics snapshot, but
//     internally REFRESHES `lastCheck`, CPU load, memory usage, and the cached
//     agent/task counts every call, then calls `saveMetrics(currentMetrics)` —
//     a side-effecting whole-document rewrite. The cli's read-shaped return is
//     dressed over a write. The audit chain is designed to record exactly this
//     class of refresh-on-read; one registry entry per cli tool name.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/system-tools.ts`
// `system_metrics` handler (lines 137-280). The cli callsite stays in place
// until the dispatch boundary is wired through cli; this file establishes the
// registration shape the dispatch path will resolve.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/system/metrics.json` may mutate. The underlying primitive is
// `makeFsJsonSubstrate` (substrates/fs-json-store.ts), shared with the other
// `system_*` mutation handlers — all three route through the same FS-JSON
// store under one cross-process O_EXCL sentinel lock.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as os from 'node:os';
import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/**
 * Shape of `.claude-flow/system/metrics.json` — mirrors `SystemMetrics` at
 * system-tools.ts:37-47. Shared across the three `system_*` mutation handlers
 * (metrics / health / reset) so they round-trip one canonical document type.
 */
export interface SystemMetrics {
  startTime: string;
  lastCheck: string;
  uptime: number;
  health: number;
  cpu: number;
  memory: { used: number; total: number };
  agents: { active: number; total: number };
  tasks: { pending: number; completed: number; failed: number };
  requests: { total: number; success: number; errors: number };
}

/**
 * Default metrics document — mirrors the `loadMetrics` fallback (system-tools.ts:73-83)
 * and the `system_reset` default-construction (system-tools.ts:467-477). Captures
 * real CPU/memory at construction time via the `os` module, exactly as the cli does.
 */
export function defaultSystemMetrics(): SystemMetrics {
  const now = new Date().toISOString();
  return {
    startTime: now,
    lastCheck: now,
    uptime: 0,
    health: 1.0,
    cpu: (os.loadavg()[0] * 100) / os.cpus().length,
    memory: {
      used: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024),
      total: Math.round(os.totalmem() / 1024 / 1024),
    },
    agents: { active: 0, total: 0 },
    tasks: { pending: 0, completed: 0, failed: 0 },
    requests: { total: 0, success: 0, errors: 0 },
  };
}

/** Metrics category — mirrors the CLI inputSchema enum (system-tools.ts:144). */
export type SystemMetricsCategory =
  | 'all'
  | 'cpu'
  | 'memory'
  | 'agents'
  | 'tasks'
  | 'requests';

/** Output format — mirrors system-tools.ts:146. */
export type SystemMetricsFormat = 'json' | 'table' | 'summary';

/**
 * Mutation payload mirroring the CLI tool's `system_metrics` input shape
 * (system-tools.ts inputSchema lines 142-148). All fields optional;
 * `category` defaults to `'all'` at the wire-up callsite.
 */
export interface SystemMetricsPayload {
  readonly category?: SystemMetricsCategory;
  readonly timeRange?: string;
  readonly format?: SystemMetricsFormat;
}

const STORE_ID = 'system_metrics' as StoreId;

/**
 * Read agent/task counts from the backward-compat JSON store files under
 * `<projectRoot>/.claude-flow/{agents,tasks}/store.json`. This is the cli's
 * JSON-store fallback path (system-tools.ts:199-225) — plain filesystem reads
 * of OTHER stores, not a mutation of `metrics.json`, so it runs OUTSIDE the
 * `withWrite` scope per the substrate seam.
 *
 * SCOPE NOTE: the cli ALSO has an AgentDB-first path (system-tools.ts:166-196)
 * that reads the same counts via `routeMemoryOp` against the AgentDB vector
 * store. That backend is constructed in the cli process, not the archivist —
 * porting it needs the cli-delegation boundary, so it is the deferred
 * optimization here (an out-of-band read of a separate substrate, never a
 * `metrics.json` mutation). The JSON-store read below is a complete, faithful
 * count source; the AgentDB-first read only changes WHERE the counts come
 * from, not the metrics document this handler writes.
 */
function readJsonStoreCounts(projectRoot: string): {
  agents: { active: number; total: number };
  tasks: { pending: number; completed: number; failed: number };
} {
  const agents = { active: 0, total: 0 };
  const tasks = { pending: 0, completed: 0, failed: 0 };

  const agentStorePath = join(projectRoot, '.claude-flow', 'agents', 'store.json');
  if (existsSync(agentStorePath)) {
    const agentStore = JSON.parse(readFileSync(agentStorePath, 'utf-8')) as {
      agents?: Record<string, { status: string }>;
    };
    const list = Object.values(agentStore.agents ?? {});
    agents.total = list.length;
    agents.active = list.filter(
      (a) => a.status === 'active' || a.status === 'running',
    ).length;
  }

  const taskStorePath = join(projectRoot, '.claude-flow', 'tasks', 'store.json');
  if (existsSync(taskStorePath)) {
    const taskStore = JSON.parse(readFileSync(taskStorePath, 'utf-8')) as {
      tasks?: Record<string, { status: string }>;
    };
    const list = Object.values(taskStore.tasks ?? {});
    tasks.pending = list.filter(
      (t) => t.status === 'pending' || t.status === 'assigned',
    ).length;
    tasks.completed = list.filter((t) => t.status === 'completed').length;
    tasks.failed = list.filter((t) => t.status === 'failed').length;
  }

  return { agents, tasks };
}

// Body ported from system-tools.ts `system_metrics` handler (lines 149-241).
// The cli's `loadMetrics` → real-metrics-via-`os.loadavg()`/`os.totalmem()` →
// agent/task count read → `saveMetrics` pipeline collapses into the single
// `ctx.substrate.withWrite` because the substrate primitive owns durability +
// isolation. The count read (JSON-store path) and the CPU/memory probes are
// plain `os`/`fs` reads — they do NOT mutate `metrics.json` so they run
// outside the withWrite scope; only the final metrics-document write moves
// inside. The category-specific RETURN shaping (system-tools.ts:243-278) is a
// pure read projection with no persisted effect — it is the read-handler's
// job, not this mutation's; this handler's contract is the metrics-document
// refresh-write.
export const systemMetricsHandler: GuardedWrite<SystemMetricsPayload> =
  registerMutationHandler<SystemMetricsPayload>(
    'system_metrics',
    async (ctx: MutationContext<false>, _payload: SystemMetricsPayload): Promise<void> => {
      // Out-of-band reads — real system metrics + cross-store counts. These
      // observe OTHER state (the process, the os, sibling JSON stores); they
      // are not a `metrics.json` mutation, so they stay outside `withWrite`.
      const loadAvg = os.loadavg();
      const cpuCount = os.cpus().length;
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const { agents, tasks } = readJsonStoreCounts(ctx.projectRoot);

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<SystemMetrics>({
          storeId: STORE_ID,
          key: 'root',
        });
        const store: SystemMetrics = current ?? defaultSystemMetrics();

        const next: SystemMetrics = {
          ...store,
          cpu: (loadAvg[0] * 100) / cpuCount,
          memory: {
            used: Math.round((totalMem - freeMem) / 1024 / 1024),
            total: Math.round(totalMem / 1024 / 1024),
          },
          agents,
          tasks,
          // requests: no MCP request-tracking infrastructure yet — preserved
          // at the stored value, matching system-tools.ts:236.
          uptime: Date.now() - new Date(store.startTime).getTime(),
          lastCheck: new Date().toISOString(),
        };

        await handle.write({ storeId: STORE_ID, key: 'root', payload: next });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
