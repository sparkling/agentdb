// charter: dispatch
// memory_search_unified read handler (ADR-0180 Phase 3, §Architecture · Read-path return shape).
// Cross-store fusion across Claude-Code memories + AgentDB namespaces. Per ADR-0180
// the archivist performs dedup and Reciprocal Rank Fusion (k=60) over per-store ranked
// candidates; raw scores never feed RRF, only ranks. Stores contribute ordered candidates
// with raw scores only. Provenance per RankedResult records the contributing storeId and
// rank so ExplainableRecall can be reconstructed without a second query.

import { registerReadHandler, type GuardedRead, type ReadContext } from '../../index.js';
import type { MemoryRecord, RankedResults } from './search.js';

export interface MemorySearchUnifiedQuery {
  readonly query: string;
  readonly limit?: number;
  readonly namespace?: string;
  readonly includeProvenance?: boolean;
}

// RRF constant per ADR-0180 §Read-path return shape — chosen because it operates on
// ranks rather than raw scores, making BM25 + semantic stores composable without score
// normalization. Per-store weights live in archivist config (TODO Phase 3 wire-up).
export const RRF_K = 60;

// TODO(ADR-0180 Phase 3 wire-up): port the cross-store fusion body from
// cli/src/mcp-tools/memory-tools.ts case 'memory_search_unified' (namespace fan-out,
// dedup-by-key) and replace its raw-score sort with RRF combination over each store's
// ranked candidates. The MCP layer flattens to legacy `{ id, content, score }[]` unless
// `includeProvenance: true` is set; this handler always returns the full RankedResult
// shape and the dispatch boundary flattens at the MCP edge.
export const searchUnifiedMemoryHandler: GuardedRead<MemorySearchUnifiedQuery, RankedResults<MemoryRecord>> =
  registerReadHandler<MemorySearchUnifiedQuery, RankedResults<MemoryRecord>>(
    'memory_search_unified',
    async (_ctx: ReadContext, _payload: MemorySearchUnifiedQuery): Promise<RankedResults<MemoryRecord>> => {
      throw new Error(
        'archivist: memory_search_unified handler body pending Phase 3 wire-up; ' +
        'callers currently route through cli/src/mcp-tools/memory-tools.ts case \'memory_search_unified\'',
      );
    },
    { cacheScope: 'global' },
  );
