// charter: dispatch
// memory_bridge_status read handler (ADR-0180 Phase 3, §Architecture · Read-path return shape).
// Status-class, not search-style: surfaces the archivist's current state (init
// progress, fast-path buffer occupancy, write rates per store) as one ranked
// entry per component. Each entry carries provenance so telemetry consumers can
// map back to the source store/namespace, matchType='status' (Pass-3 disposition).

import { registerReadHandler, type GuardedRead, type ReadContext } from '../../index.js';
import type { RankedResults } from './search.js';

export interface MemoryBridgeStatusQuery {
  readonly detail?: 'brief' | 'verbose';
}

export interface BridgeStatusEntry {
  readonly component: string;
  readonly state: 'up' | 'down' | 'degraded';
  readonly metadata: Record<string, unknown>;
}

// TODO(ADR-0180 Phase 3 wire-up): port the inline status assembly from
// cli/src/mcp-tools/memory-tools.ts memory_bridge_status handler (Claude
// memory file scan, listEntries probe per namespace, intelligence stats).
// The cli branch stays in place until the dispatch boundary is wired through;
// this handler is the registration shape the dispatch path will resolve.
export const bridgeStatusHandler: GuardedRead<MemoryBridgeStatusQuery, RankedResults<BridgeStatusEntry>> =
  registerReadHandler<MemoryBridgeStatusQuery, RankedResults<BridgeStatusEntry>>(
    'memory_bridge_status',
    async (_ctx: ReadContext, _payload: MemoryBridgeStatusQuery): Promise<RankedResults<BridgeStatusEntry>> => {
      throw new Error(
        'archivist: memory_bridge_status handler body pending Phase 3 wire-up; ' +
        'callers currently route through cli/src/mcp-tools/memory-tools.ts memory_bridge_status handler',
      );
    },
    { cacheScope: 'global' },
  );
