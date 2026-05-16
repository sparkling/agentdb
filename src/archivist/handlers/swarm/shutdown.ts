// charter: dispatch
// swarm_shutdown mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers as `GuardedWrite<SwarmShutdownPayload>` because shutdown is the
// most-destructive swarm transition: it flips `target.status = 'terminated'`,
// reaps the agent roster, and persists the updated `SwarmState` — every
// shutdown MUST flow through the audit chain (intent → applied | rejected)
// with guard verdicts + invariant verdicts.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/swarm-tools.ts`
// `swarm_shutdown` handler (lines 413-467) — load → resolve target swarm
// (explicit `swarmId` else most-recently-updated `status === 'running'`) →
// guard `already-terminated` → flip status → bump `updatedAt` →
// `saveSwarmStore`. The cli callsite stays in place until the dispatch
// boundary is wired through cli (mirroring memory_store, hive-mind_spawn
// pending wire-up). This file establishes the registration shape the
// dispatch path will resolve.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// swarm coordination state may mutate. Direct fs writes are forbidden by the
// `no-restricted-imports` backstop and the path-restricted
// substrate-internal.ts seam (ADR-0180 §Type enforcement). Production wire-up
// instantiates the FS-JSON store via `makeFsJsonSubstrate` from
// `archivist/substrates` — the substrate's O_EXCL sentinel lock subsumes the
// legacy `withSwarmStoreLock` because the migrated wire-up routes the swarm
// store through the same primitive.

import { registerMutationHandler } from '../../registration.js';
import type {
  GuardedWrite,
  MutationContext,
  StoreId,
} from '../../index.js';
import { reconcileOrphanSwarms, type SwarmState, type SwarmStore } from './shared.js';
import { swarmShutdownInvariants } from '../../invariants/swarm/index.js';

/**
 * Mutation payload mirroring the CLI tool's `swarm_shutdown` input shape
 * (swarm-tools.ts:418-422). Both fields are optional: an absent `swarmId`
 * selects the most-recently-updated `status === 'running'` swarm (cli's
 * `running[0]` fall-through); `graceful` defaults to `true` at the wire-up
 * callsite.
 */
export interface SwarmShutdownPayload {
  readonly swarmId?: string;
  readonly graceful?: boolean;
}

const STORE_ID = 'swarm_shutdown' as StoreId;

// Ported from swarm-tools.ts `swarm_shutdown` handler. The cli's
// `withSwarmStoreLock` collapses to a single `ctx.substrate.withWrite` — the
// substrate primitive owns the O_EXCL lock. #1799 orphan reconciliation runs
// in-memory on the loaded store; its mutations are persisted BEFORE any
// post-reconcile throw via the reconciliation-coupling fix (substrate
// semantic: `handle.write` commits per call via atomic rename, NOT per
// withWrite scope — a throw only loses writes not yet issued). See the
// inline comment at the reconcile call for the queen-ruling-2026-05-15
// trace + the corrected carry-forward memo. `target` resolves via explicit
// `swarmId` lookup or the most-recently-updated-running fall-through. The
// "not-found" and "already-terminated" guards throw fail-loud under the
// void mutation contract; reconciliation results survive the throw via the
// gated pre-throw write. Agent-roster reap dispatches through the
// agents.json store's own mutation handler (out-of-scope here, in scope
// for invariants-author).
export const shutdownSwarmHandler: GuardedWrite<SwarmShutdownPayload> =
  registerMutationHandler<SwarmShutdownPayload>(
    'swarm_shutdown',
    async (ctx: MutationContext<false>, payload: SwarmShutdownPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<SwarmStore>({ storeId: STORE_ID, key: 'root' });
        const store: SwarmStore = current ?? { swarms: {}, version: '3.0.0' };

        // #1799 — reconcile orphans on load. Reconciliation produces a fully-
        // consistent store snapshot independent of the shutdown op below, so
        // when target resolution then throws (not-found / already-terminated)
        // we MUST flush reconciliation before the throw or its mutations are
        // lost. `withWrite` is not transactional — `handle.write` commits via
        // atomic rename on each call, and a throw only loses un-issued writes
        // (queen ruling 2026-05-15; carry-forward at
        // adr-0181/carry-forward-swarm-reconciliation-coupling corrected).
        // Matches cli `loadSwarmStore` which persists reconciliation eagerly
        // on load (swarm-tools.ts:139-145) so a typo'd swarmId on a stale
        // dead-host running entry doesn't produce infinite re-discovery.
        const reconciled = reconcileOrphanSwarms(store);

        let target: SwarmState | undefined;
        if (payload.swarmId && store.swarms[payload.swarmId]) {
          target = store.swarms[payload.swarmId];
        } else {
          // Shutdown most-recently-updated running swarm.
          const running = Object.values(store.swarms)
            .filter((s) => s.status === 'running')
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
          target = running[0];
        }

        if (!target) {
          if (reconciled > 0) {
            await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
          }
          throw new Error(
            payload.swarmId
              ? `archivist: swarm_shutdown — swarm not found: ${payload.swarmId}`
              : 'archivist: swarm_shutdown — no running swarms to shut down',
          );
        }
        if (target.status === 'terminated') {
          if (reconciled > 0) {
            await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
          }
          throw new Error(
            `archivist: swarm_shutdown — swarm already terminated: ${target.swarmId}`,
          );
        }

        target.status = 'terminated';
        target.updatedAt = new Date().toISOString();
        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: swarmShutdownInvariants,
      cacheScope: 'global',
    },
  );
