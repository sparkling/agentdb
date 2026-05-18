// charter: dispatch
// ADR-0184 Wave 1 skeleton — bft strategy handler body pending Wave 2 wire-up.
// The parent dispatcher (../consensus.ts) normalises `byzantine → bft` at entry
// (mirroring cli hive-mind-tools.ts line 2056 `input.strategy = 'bft'`), so this
// handler MUST treat `payload.strategy === 'bft'` as the canonical value and
// MUST NOT re-read or re-dispatch on `'byzantine'`. Wave 2 ports the cli's
// f+1-of-2f+1 voting threshold + equivocation detection (ADR-0098) verbatim.
//
// Stub-throw is keyed by strategy so Wave 1's structural unit test can assert
// each strategy routes to its own pending message.

import type { MutationContext } from '../../../index.js';
import type { HiveMindConsensusPayload } from '../consensus.js';

export async function handleBftConsensus(
  _ctx: MutationContext<false>,
  _payload: HiveMindConsensusPayload,
): Promise<void> {
  throw new Error(
    'archivist: hive-mind_consensus[bft] handler body pending ADR-0184 Wave 2 wire-up; ' +
    'callers currently route through cli/src/mcp-tools/hive-mind-tools.ts hive-mind_consensus handler',
  );
}
