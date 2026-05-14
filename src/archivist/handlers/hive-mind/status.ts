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

import { registerReadHandler, type GuardedRead, type ReadContext } from '../../index';
import type { RankedResults } from '../memory/search';

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

// TODO(ADR-0180 Phase 4 wire-up): port the body of hive-mind-tools.ts
// `hive-mind_status` callsite (lines 1672-1809) once the dispatch boundary is
// wired through cli. The cli's direct `loadHiveState` / `loadAgentStore`
// reads collapse to `ctx.substrate.read` against the FS-JSON primitive
// (shared with spawn/consensus/agents-json). ADR-0131 (T12) reconciliation
// (`reconcileFailedFromStatusKeys` + `saveHiveState`) is a status-time
// mutation — wire that path through `dispatch('hive-mind_status_reconcile', ...)`
// per the consensus precedent rather than fanning out a write from the read
// handler. The status response decomposes into a ranked-results array (one
// HiveMindStatusEntry per component) with matchType='status'.
export const statusHiveMindHandler: GuardedRead<HiveMindStatusQuery, RankedResults<HiveMindStatusEntry>> =
  registerReadHandler<HiveMindStatusQuery, RankedResults<HiveMindStatusEntry>>(
    'hive-mind_status',
    async (_ctx: ReadContext, _payload: HiveMindStatusQuery): Promise<RankedResults<HiveMindStatusEntry>> => {
      throw new Error(
        'archivist: hive-mind_status handler body pending Phase 4 wire-up; ' +
        'callers currently route through cli/src/mcp-tools/hive-mind-tools.ts hive-mind_status handler',
      );
    },
    { cacheScope: 'global' },
  );
