// charter: dispatch
// ADR-0184 Wave 1 skeleton — gossip strategy handler body pending Wave 4 wire-up.
// Wave 4 ports the cli's push-style epidemic propagation + `roundTimeoutMs`
// per-round bound + eventual-consistency settling via `settleCheckGossip`
// (ADR-0120 T2). Wave 4 also resolves Open Follow-up #1 (ADR-0131 auto-status-
// transition timing — inline vs separate `status_settle` mutation).

import type { MutationContext, SubstrateHandle } from '../../../index.js';
import type { HiveMindConsensusPayload } from '../consensus.js';

export async function handleGossipConsensus(
  _ctx: MutationContext<false>,
  _handle: SubstrateHandle,
  _payload: HiveMindConsensusPayload,
): Promise<void> {
  throw new Error(
    'archivist: hive-mind_consensus[gossip] handler body pending ADR-0184 Wave 4 wire-up; ' +
    'callers currently route through cli/src/mcp-tools/hive-mind-tools.ts hive-mind_consensus handler',
  );
}
