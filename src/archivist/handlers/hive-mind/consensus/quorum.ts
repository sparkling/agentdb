// charter: dispatch
// ADR-0184 Wave 1 skeleton — quorum strategy handler body pending Wave 2 wire-up.
// Wave 2 ports the cli's `quorumPreset: unanimous | majority | supermajority`
// threshold arithmetic via `calculateRequiredVotes` + `tryResolveProposal`.

import type { MutationContext } from '../../../index.js';
import type { HiveMindConsensusPayload } from '../consensus.js';

export async function handleQuorumConsensus(
  _ctx: MutationContext<false>,
  _payload: HiveMindConsensusPayload,
): Promise<void> {
  throw new Error(
    'archivist: hive-mind_consensus[quorum] handler body pending ADR-0184 Wave 2 wire-up; ' +
    'callers currently route through cli/src/mcp-tools/hive-mind-tools.ts hive-mind_consensus handler',
  );
}
