// charter: dispatch
// ADR-0184 Wave 1 skeleton — raft strategy handler body pending Wave 2 wire-up.
// Wave 2 ports the cli's term-based leader election + `timeoutMs` re-proposal
// trigger (ADR-0117). The single-pending-proposal-per-term guard at cli
// hive-mind-tools.ts ~2072 ports verbatim.

import type { MutationContext } from '../../../index.js';
import type { HiveMindConsensusPayload } from '../consensus.js';

export async function handleRaftConsensus(
  _ctx: MutationContext<false>,
  _payload: HiveMindConsensusPayload,
): Promise<void> {
  throw new Error(
    'archivist: hive-mind_consensus[raft] handler body pending ADR-0184 Wave 2 wire-up; ' +
    'callers currently route through cli/src/mcp-tools/hive-mind-tools.ts hive-mind_consensus handler',
  );
}
