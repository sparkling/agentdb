// charter: dispatch
// hive-mind_status read handler (ADR-0180 Phase 4, §Architecture · Read-path return shape).
// Status-class, not search-style: surfaces hive-mind health (hive root,
// queen, workers, metrics, health bands) as one ranked entry per component,
// matching `memory_bridge_status`'s Phase 3 shape. Each entry carries
// provenance so telemetry consumers map back to the source store/component,
// matchType='status' per the closed Provenance union in handlers/memory/search.ts.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/hive-mind-tools.ts`
// `hive-mind_status` handler — loadHiveState → reconcileFailedFromStatusKeys
// (ADR-0131 T12) → loadAgentStore → compose status object (hive/queen/workers/
// metrics/health/failedWorkers) → optional verbose-tail (workerDetails,
// consensusHistory, sharedMemory). The cli callsite stays in place until the
// dispatch boundary is wired through cli (mirroring consensus/spawn/agents-json
// pending wire-up). This file establishes the registration shape the
// dispatch path will resolve.
//
// Type-enforcement: reads pass through `ctx.substrate` (ReadOnlySubstrateAccess);
// direct fs reads of state.json / agents.json from store-tree code are
// forbidden by the path-restricted substrate-internal.ts seam (ADR-0180
// §Type enforcement). The cli body owns the direct-fs reads today; once the
// dispatch boundary flips, this handler reads via `ctx.substrate.read` against
// the same `makeFsJsonSubstrate` primitive that the mutation peers (spawn,
// consensus, agents-json) use.

import { registerReadHandler } from '../../registration.js';
import type {
  GuardedRead,
  ReadContext,
  StoreId,
} from '../../index.js';
import type { RankedResult, RankedResults } from '../memory/search.js';
import type { HiveStateDoc } from './hive-state.js';
// Sibling invariant file at ../../invariants/hive-mind/status.ts ships
// request-payload invariants as the contract spec. `RegisterReadOpts` does
// NOT accept an `invariants` array today (registration.ts L46-48), so we
// cannot pass them here — the file exists for the eventual ADR-0180 §Read-
// path return-shape design landing.

/** Query payload — mirrors the cli tool's inputSchema (line 1666-1670 of
 *  hive-mind-tools.ts). `verbose` adds workerDetails / consensusHistory /
 *  sharedMemory tails to the response. */
export interface HiveMindStatusQuery {
  readonly verbose?: boolean;
}

/** Per-component status entry. `component` discriminates the slice of state
 *  surfaced (hive root, queen, each worker, metrics, health bands, failed
 *  workers). `state ∈ {up,down,degraded}` mirrors `memory_bridge_status`'s
 *  closed band; metadata carries the component-specific payload (e.g. queen
 *  carries `{ agentId, term, electedAt, queenType?, load, tasksQueued }`). */
export interface HiveMindStatusEntry {
  readonly component: string;
  readonly state: 'up' | 'down' | 'degraded';
  readonly metadata: Record<string, unknown>;
}

const HIVE_STORE_ID = 'hive-mind_spawn' as StoreId;

// F4-2 body: substrate-read decomposition of the hive state into per-component
// status entries. The full cli composition (cli/src/mcp-tools/hive-mind-tools.ts
// lines 1772-1909) blends data from THREE substrates — hive-mind state, agents
// store, and tasks store — plus an in-handler `reconcileFailedFromStatusKeys`
// mutation (ADR-0131 T12). Per the file-header rationale, agent-store /
// task-store cross-reads and the §6 absence-marker reconciliation are
// out-of-scope for this read handler:
//   - cross-store reads need separate `ctx.substrate.read` calls per storeId
//     (substrate-internal.ts ReadOnlySubstrateAccess is single-store-scoped
//     by construction, ADR-0180 §Type enforcement);
//   - reconciliation is a write side-effect (`saveHiveState` after marking
//     workers absent) and a read handler cannot mutate (`feedback-no-fallbacks`
//     — silent write from a read path would bypass the audit chain).
//
// The full-fidelity orchestration therefore stays cli-side until Phase 6+
// breaks the cross-store fan-out into separate handlers and routes the
// reconciliation through `dispatch('hive-mind_status_reconcile', …)`. Today's
// cli surface (`hive-mind_status` handler at hive-mind-tools.ts:1772) does
// NOT call `dispatch('hive-mind_status', …)` — the cli comment at
// hive-mind-tools.ts:1761 explicitly defers the flip — so this handler body
// is governance-shape coverage: when the cli eventually flips, the dispatch
// path resolves a substrate-only projection of hive root health (queen
// presence, worker count, consensus pending) instead of throwing.
//
// Returns one entry per component slice (hive root + queen + each worker +
// consensus). Each entry's `state` band derives from the substrate doc:
//   - `up` when the slice is healthy (hive initialized, queen elected, worker
//     in agents-store as `idle|busy`, consensus has no overdue proposals);
//   - `down` when the slice is missing or terminal (hive not initialized,
//     no queen, worker absent from agents-store);
//   - `degraded` when the slice is present but partial (worker has failedAt,
//     consensus has overdue pending proposals).
//
// `provenance.matchType: 'status'` per the closed Provenance union in
// handlers/memory/search.ts L61. `score` is the rank position normalized to
// `[0,1]` so the canonical RankedResults ordering is deterministic.
export const statusHiveMindHandler: GuardedRead<HiveMindStatusQuery, RankedResults<HiveMindStatusEntry>> =
  registerReadHandler<HiveMindStatusQuery, RankedResults<HiveMindStatusEntry>>(
    'hive-mind_status',
    async (ctx: ReadContext, payload: HiveMindStatusQuery): Promise<RankedResults<HiveMindStatusEntry>> => {
      const state = await ctx.substrate.read<HiveStateDoc>({ storeId: HIVE_STORE_ID, key: 'root' });

      const entries: HiveMindStatusEntry[] = [];

      // HiveStateDoc carries unrelated cli fields (queen, topology,
      // consensusStrategy, …) via its `[key: string]: unknown` index
      // signature — narrow them lazily through this shape (no runtime
      // dependency on cli's HiveState type, ADR-0180 §Type enforcement).
      const queen = (state as { queen?: { agentId?: unknown; term?: unknown; electedAt?: unknown; queenType?: unknown } } | undefined | null)?.queen;
      const topology = (state as { topology?: unknown } | undefined | null)?.topology;
      const consensusStrategy = (state as { consensusStrategy?: unknown } | undefined | null)?.consensusStrategy;

      // Hive root — `up` iff `state` exists AND `initialized === true`. Down
      // for both "no doc on disk" and "doc exists but initialized=false"
      // (post-shutdown shape, mirrors cli's `state.initialized ? 'active' : 'offline'`).
      const hiveUp = state !== undefined && state !== null && state.initialized === true;
      entries.push({
        component: 'hive',
        state: hiveUp ? 'up' : 'down',
        metadata: {
          initialized: hiveUp,
          topology,
          createdAt: state?.createdAt,
          updatedAt: state?.updatedAt,
        },
      });

      // Queen — `up` iff state exists AND queen object set. Mirrors cli's
      // `state.queen ? { id, agentId, status: 'active', electedAt, term, queenType? } : { id: 'N/A', status: 'offline' }`.
      if (queen) {
        entries.push({
          component: 'queen',
          state: 'up',
          metadata: {
            agentId: queen.agentId,
            term: queen.term,
            electedAt: queen.electedAt,
            ...(queen.queenType !== undefined ? { queenType: queen.queenType } : {}),
          },
        });
      } else {
        entries.push({
          component: 'queen',
          state: 'down',
          metadata: { reason: 'no-queen-elected' },
        });
      }

      // Workers — one entry per worker id in `state.workers`. `state` derives
      // from `state.workerMeta[id].failedAt` (ADR-0131 T12): present + failedAt
      // is non-null => `degraded`; present + failedAt is null => `up`. Without
      // the agents-store cross-read we cannot surface `agent.status` /
      // `currentTask` / `tasksCompleted` — those stay cli-side until the
      // cross-store fan-out lands.
      const workerIds = state?.workers ?? [];
      for (const workerId of workerIds) {
        const meta = state?.workerMeta?.[workerId];
        const failedAt = meta?.failedAt ?? null;
        entries.push({
          component: `worker:${workerId}`,
          state: failedAt !== null ? 'degraded' : 'up',
          metadata: {
            workerId,
            failedAt,
            retryOf: meta?.retryOf ?? null,
          },
        });
      }

      // Consensus — `degraded` iff any pending proposal is past its
      // `timeoutAt`; `up` iff all pending proposals are within timeout (or
      // none pending); `down` iff the consensus slice is missing entirely.
      if (state?.consensus) {
        const pending = state.consensus.pending ?? [];
        const now = Date.now();
        let overdue = 0;
        for (const proposal of pending) {
          // proposal is `unknown` per HiveStateDoc.consensus.pending typing —
          // narrow to the timeoutAt field via in-check before parsing.
          const timeoutAt = (proposal as { timeoutAt?: unknown } | null)?.timeoutAt;
          if (typeof timeoutAt === 'string' && new Date(timeoutAt).getTime() <= now) {
            overdue++;
          }
        }
        entries.push({
          component: 'consensus',
          state: overdue > 0 ? 'degraded' : 'up',
          metadata: {
            pendingCount: pending.length,
            historyCount: state.consensus.history?.length ?? 0,
            overdueCount: overdue,
            strategy: consensusStrategy,
          },
        });
      } else {
        entries.push({
          component: 'consensus',
          state: 'down',
          metadata: { reason: 'no-consensus-state' },
        });
      }

      // Verbose mode — surface the per-component shared-memory + raw worker
      // list as additional entries. Mirrors the cli's verbose tail
      // (workerDetails, consensusHistory, sharedMemory) but in the ranked-
      // results shape.
      if (payload.verbose && state) {
        entries.push({
          component: 'sharedMemory',
          state: 'up',
          metadata: {
            keys: Object.keys(state.sharedMemory ?? {}),
            count: Object.keys(state.sharedMemory ?? {}).length,
          },
        });
        if (state.consensus?.history?.length) {
          entries.push({
            component: 'consensusHistory',
            state: 'up',
            metadata: {
              recent: state.consensus.history.slice(-10),
            },
          });
        }
      }

      // Wrap each entry in the canonical RankedResult shape with
      // matchType='status' (the closed Provenance union explicitly admits
      // 'status' for the status-class read handlers — handlers/memory/search.ts L61).
      const total = entries.length;
      return entries.map((entry, index): RankedResult<HiveMindStatusEntry> => ({
        item: entry,
        score: total > 0 ? 1 - index / total : 1,
        provenance: {
          storeId: HIVE_STORE_ID as string,
          matchType: 'status',
          rawScore: total > 0 ? 1 - index / total : 1,
          rank: index + 1,
          matchedField: entry.component,
        },
      }));
    },
    { cacheScope: 'global' },
  );
