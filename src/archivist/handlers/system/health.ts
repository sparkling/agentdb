// charter: dispatch
// system_health mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers as `GuardedWrite<SystemHealthPayload>` so every health-check transition
// flows through the archivist's audit-chain (intent → applied | rejected) with
// guard verdicts + invariant verdicts recorded.
//
// Why a read-shaped cli surface registers as a MUTATION handler:
//   - The cli `system_health` handler computes a health score over a fixed set of
//     component probes (memory store, config, mcp, swarm, neural, optionally disk
//     / network / database) and then UPDATES `metrics.health` via
//     `saveMetrics(metrics)` (system-tools.ts:394-395). The audit chain records
//     this score-write so observers can replay the health timeline. One registry
//     entry per cli tool name.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/system-tools.ts`
// `system_health` handler (lines 281-411). The cli callsite stays in place until
// the dispatch boundary is wired through cli; this file establishes the
// registration shape the dispatch path will resolve.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/system/metrics.json` may mutate. The underlying primitive is
// `makeFsJsonSubstrate` (substrates/fs-json-store.ts), shared with the other
// `system_*` mutation handlers — all three route through the same FS-JSON
// store under one cross-process O_EXCL sentinel lock.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as os from 'node:os';
import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';
import { healthInvariants } from '../../invariants/system/health.js';
import { defaultSystemMetrics, type SystemMetrics } from './metrics.js';

/**
 * Mutation payload mirroring the CLI tool's `system_health` input shape
 * (system-tools.ts inputSchema lines 285-292). All fields optional;
 * defaults applied at the wire-up callsite.
 */
export interface SystemHealthPayload {
  readonly deep?: boolean;
  readonly components?: ReadonlyArray<string>;
  readonly fix?: boolean;
}

const STORE_ID = 'system_metrics' as StoreId;

/**
 * Run the cli's `system_health` component probes (system-tools.ts:295-391) and
 * return the computed overall health score in `[0, 1]`. Every probe is a
 * read-only `fs.existsSync` / `process` / `os` inspection — none mutates
 * `metrics.json`, so the whole probe sequence runs OUTSIDE the `withWrite`
 * scope. Only the resulting score is carried into the substrate write.
 */
function computeHealthScore(projectRoot: string, deep: boolean): number {
  const checks: Array<{ status: string }> = [];

  // Memory store — store file present?
  checks.push({
    status: existsSync(join(projectRoot, '.claude-flow', 'memory', 'store.json'))
      ? 'healthy'
      : 'degraded',
  });

  // Config — primary or alternate config file present?
  const configExists =
    existsSync(join(projectRoot, '.claude-flow', 'config.json')) ||
    existsSync(join(projectRoot, 'claude-flow.config.json'));
  checks.push({ status: configExists ? 'healthy' : 'degraded' });

  // MCP — this process is the MCP server when stdin is piped (not a TTY).
  checks.push({ status: !process.stdin.isTTY ? 'healthy' : 'unknown' });

  // Swarm / neural — not monitorable from here; cli reports 'unknown'.
  checks.push({ status: 'unknown' });
  checks.push({ status: 'unknown' });

  if (deep) {
    // Disk — cli touches `os` mem as a proxy but reports 'unknown' (no statvfs).
    void os.freemem();
    checks.push({ status: 'unknown' });
    // Network — not monitored without making a request.
    checks.push({ status: 'unknown' });
    // Database — coordination store file present?
    checks.push({
      status: existsSync(join(projectRoot, '.claude-flow', 'coordination', 'store.json'))
        ? 'healthy'
        : 'unknown',
    });
  }

  const healthy = checks.filter((c) => c.status === 'healthy').length;
  return healthy / checks.length;
}

// Body ported from system-tools.ts `system_health` handler (lines 293-395).
// The cli's probe-sequence → score computation → `metrics.health = score` →
// `saveMetrics` collapses into the single `ctx.substrate.withWrite` because
// the substrate primitive owns durability + isolation. The probes themselves
// are read-only `fs.existsSync` / `process` / `os` inspections — they observe
// OTHER state, not `metrics.json`, so they run outside the withWrite scope;
// only the final `metrics.health` score-write moves inside.
//
// SCOPE NOTE: the cli's rich RETURN shape (per-check status + latency + issue
// list, system-tools.ts:397-409) is a pure read projection with no persisted
// effect — it belongs to the read-handler split, not this mutation. The `fix`
// flag is unused in the cli today (system-tools.ts:291); it carries no
// behaviour here and stays a no-op until the deferred autoremediation path is
// designed.
export const systemHealthHandler: GuardedWrite<SystemHealthPayload> =
  registerMutationHandler<SystemHealthPayload>(
    'system_health',
    async (ctx: MutationContext<false>, payload: SystemHealthPayload): Promise<void> => {
      // Out-of-band probes — read-only filesystem / process / os inspections.
      // Not a `metrics.json` mutation, so they stay outside `withWrite`.
      const score = computeHealthScore(ctx.projectRoot, payload.deep ?? false);

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<SystemMetrics>({
          storeId: STORE_ID,
          key: 'root',
        });
        const store: SystemMetrics = current ?? defaultSystemMetrics();

        const next: SystemMetrics = {
          ...store,
          health: score,
          lastCheck: new Date().toISOString(),
        };

        await handle.write({ storeId: STORE_ID, key: 'root', payload: next });
      });
    },
    {
      invariants: healthInvariants,
      cacheScope: 'store',
    },
  );
