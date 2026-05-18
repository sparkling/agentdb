// charter: dispatch
// ADR-0184 Wave 1 skeleton — weighted strategy handler body pending Wave 3 wire-up.
// Wave 3 ports the cli's queen-3x voting power logic (ADR-0119 T1, USERGUIDE).
// Requires `state.queen` defined at propose AND vote — throws
// MissingQueenForWeightedConsensusError on either path (cli ~2026, ~2230).

import type { MutationContext, SubstrateHandle } from '../../../index.js';
import type { HiveMindConsensusPayload } from '../consensus.js';

export async function handleWeightedConsensus(
  _ctx: MutationContext<false>,
  _handle: SubstrateHandle,
  _payload: HiveMindConsensusPayload,
): Promise<void> {
  throw new Error(
    'archivist: hive-mind_consensus[weighted] handler body pending ADR-0184 Wave 3 wire-up; ' +
    'callers currently route through cli/src/mcp-tools/hive-mind-tools.ts hive-mind_consensus handler',
  );
}
