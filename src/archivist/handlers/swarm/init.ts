// charter: dispatch
// swarm_init mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers as `GuardedWrite<SwarmInitPayload>` so every swarm initialization
// transitions through the archivist's audit-chain (intent → applied | rejected)
// with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/swarm-tools.ts`
// `swarm_init` handler (line 215) — validates topology against
// VALID_TOPOLOGIES, clamps `maxAgents` to [1,50], applies ADR-0098 7-day
// dedupe TTL over `loadSwarmStore()` under `withSwarmStoreLock`, optionally
// force-creates a fresh swarm with an `audit`-logged `reason`, and persists
// the resulting `SwarmState` via `saveSwarmStore`. The cli callsite stays in
// place until the dispatch boundary is wired through cli (mirroring
// memory_store, hive-mind_spawn pending wire-up). This file establishes the
// registration shape the dispatch path will resolve.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// swarm coordination state may mutate. Direct fs writes are forbidden by the
// `no-restricted-imports` backstop and the path-restricted
// substrate-internal.ts seam (ADR-0180 §Type enforcement). Production wire-up
// instantiates the FS-JSON store via `makeFsJsonSubstrate` from
// `archivist/substrates` — the substrate's O_EXCL sentinel lock subsumes the
// legacy `withSwarmStoreLock` because the migrated wire-up routes the swarm
// store through the same primitive.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';
import { reconcileOrphanSwarms, type SwarmState, type SwarmStore } from './shared.js';

/** Topology variants — mirrors swarm-tools.ts:206-208 (`VALID_TOPOLOGIES`). */
export type SwarmTopology =
  | 'hierarchical'
  | 'mesh'
  | 'hierarchical-mesh'
  | 'ring'
  | 'star'
  | 'hybrid'
  | 'adaptive';

/** Agent strategy — mirrors the cli `strategy` default `'specialized'` (swarm-tools.ts:232). */
export type SwarmStrategy = 'specialized' | 'balanced' | 'adaptive';

/**
 * Mutation payload mirroring the CLI tool's `swarm_init` input shape
 * (swarm-tools.ts:218-228). Defaults applied at the wire-up callsite:
 * `topology='hierarchical-mesh'`, `maxAgents=15` (clamped to [1,50]),
 * `strategy='specialized'`, `force=false`. The advisory warning fires when
 * `force=true && reason===undefined` (Flaw 4 mitigation, swarm-tools.ts:244-250).
 */
export interface SwarmInitPayload {
  readonly topology?: SwarmTopology;
  readonly maxAgents?: number;
  readonly strategy?: SwarmStrategy;
  readonly config?: Record<string, unknown>;
  readonly force?: boolean;
  readonly reason?: string;
}

const STORE_ID = 'swarm_init' as StoreId;

/** Topology allow-list — mirrors swarm-tools.ts:206-208 (`VALID_TOPOLOGIES`). */
const VALID_TOPOLOGIES: ReadonlySet<string> = new Set<string>([
  'hierarchical',
  'mesh',
  'hierarchical-mesh',
  'ring',
  'star',
  'hybrid',
  'adaptive',
]);

/** ADR-0098 dedupe TTL — only reuse running swarms updated within this window. */
const SWARM_REUSE_TTL_MS = 7 * 24 * 3600 * 1000;

// Ported from swarm-tools.ts `swarm_init` handler. The cli's `withSwarmStoreLock`
// collapses to a single `ctx.substrate.withWrite` — the substrate primitive owns
// the O_EXCL lock. #1799 orphan reconciliation runs in-memory on the loaded
// store; its mutations are persisted by the same terminal `handle.write` rather
// than a separate save. Topology validation fails loud (the cli returned an
// error shape; under the void mutation contract an invalid topology is a thrown
// error). The force-without-reason advisory warning is preserved verbatim.
export const initSwarmHandler: GuardedWrite<SwarmInitPayload> =
  registerMutationHandler<SwarmInitPayload>(
    'swarm_init',
    async (ctx: MutationContext<false>, payload: SwarmInitPayload): Promise<void> => {
      const topology = payload.topology ?? 'hierarchical-mesh';
      const maxAgents = Math.min(Math.max(payload.maxAgents ?? 15, 1), 50);
      const strategy = payload.strategy ?? 'specialized';
      const config = payload.config ?? {};
      const force = payload.force === true;
      const reason = payload.reason;

      if (!VALID_TOPOLOGIES.has(topology)) {
        throw new Error(
          `archivist: swarm_init — invalid topology: ${topology}. ` +
          `Valid: ${[...VALID_TOPOLOGIES].join(', ')}`,
        );
      }

      if (force && !reason) {
        // Advisory warning — ADR-0098 Flaw 4 mitigation: force=true without a
        // reason is a drift smell.
        process.stderr.write(
          '[WARN] swarm_init called with force=true but no reason — ' +
          'prefer passing reason="..." to document why a fresh swarm is required\n',
        );
      }

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<SwarmStore>({ storeId: STORE_ID, key: 'root' });
        const store: SwarmStore = current ?? { swarms: {}, version: '3.0.0' };

        // #1799 — reconcile orphans on load. Persisted by the terminal write below.
        reconcileOrphanSwarms(store);

        const now = new Date().toISOString();
        const nowMs = Date.now();

        // ADR-0098: config-fingerprint dedupe. Reuse pool spans 'running' AND
        // host-exited 'terminated' entries (a CLI-invoked swarm always exits, so
        // #1799 reconciliation marks the prior swarm 'terminated' before the next
        // call's dedupe filter runs). Manual-shutdown / TTL-stale terminations
        // remain ineligible. Skipped entirely when force=true.
        const isReusable = (s: SwarmState): boolean => {
          if (s.status === 'running') return true;
          if (
            s.status === 'terminated' &&
            typeof s.terminationReason === 'string' &&
            /^host process \d+ exited$/.test(s.terminationReason)
          ) {
            return true;
          }
          return false;
        };

        if (!force) {
          const candidates = Object.values(store.swarms)
            .filter(
              (s) =>
                isReusable(s) &&
                s.topology === topology &&
                s.maxAgents === maxAgents &&
                (s.config as { strategy?: string }).strategy === strategy &&
                nowMs - new Date(s.updatedAt).getTime() < SWARM_REUSE_TTL_MS,
            )
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

          if (candidates.length > 0) {
            const existing = candidates[0];
            existing.updatedAt = now;
            existing.status = 'running';
            existing.pid = process.pid;
            delete existing.terminationReason;
            store.swarms[existing.swarmId] = existing;
            await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
            return;
          }
        }

        // No reuse candidate (or force=true): mint a new swarm.
        const swarmId = `swarm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const swarmState: SwarmState = {
          swarmId,
          topology,
          maxAgents,
          status: 'running',
          agents: [],
          tasks: [],
          config: {
            topology,
            maxAgents,
            strategy,
            communicationProtocol: (config.communicationProtocol as string) || 'message-bus',
            autoScaling: (config.autoScaling as boolean) ?? true,
            consensusMechanism: (config.consensusMechanism as string) || 'majority',
          },
          createdAt: now,
          updatedAt: now,
          pid: process.pid,
        };

        store.swarms[swarmId] = swarmState;
        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
