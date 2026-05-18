// charter: dispatch
// ADR-0184 Wave 1 skeleton — crdt strategy handler body pending Wave 5 wire-up.
// Wave 5 ports the cli's state-based CvRDT merge via `mergeCRDTState` (G-Counter
// / OR-Set / LWW-Register) per ADR-0121 T3. Wave 5 also resolves Open Follow-up
// #2 (mergeCRDTState import location — vendor into agentdb vs expose via
// archivist capability surface).

import type { MutationContext } from '../../../index.js';
import type { HiveMindConsensusPayload } from '../consensus.js';

export async function handleCrdtConsensus(
  _ctx: MutationContext<false>,
  _payload: HiveMindConsensusPayload,
): Promise<void> {
  throw new Error(
    'archivist: hive-mind_consensus[crdt] handler body pending ADR-0184 Wave 5 wire-up; ' +
    'callers currently route through cli/src/mcp-tools/hive-mind-tools.ts hive-mind_consensus handler',
  );
}
