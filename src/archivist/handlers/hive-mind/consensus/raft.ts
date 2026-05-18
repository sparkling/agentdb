// charter: dispatch
// ADR-0184 Wave 2 follow-up — raft strategy handler signature bumped to the
// 3-arg form `(ctx, handle, payload)` per Wave 2 DA Concern 1. The body
// still throws `pending Wave 2`; commit 2.2 lands the cli port.
//
// Wave 2 ports the cli's term-based leader election + `timeoutMs` re-proposal
// trigger (ADR-0117). The single-pending-proposal-per-term guard at cli
// hive-mind-tools.ts ~2072 ports verbatim.

import type { MutationContext, SubstrateHandle } from '../../../index.js';
import type { HiveMindConsensusPayload } from '../consensus.js';

export async function handleRaftConsensus(
  _ctx: MutationContext<false>,
  _handle: SubstrateHandle,
  _payload: HiveMindConsensusPayload,
): Promise<void> {
  throw new Error(
    'archivist: hive-mind_consensus[raft] handler body pending ADR-0184 Wave 2 wire-up; ' +
    'callers currently route through cli/src/mcp-tools/hive-mind-tools.ts hive-mind_consensus handler',
  );
}
