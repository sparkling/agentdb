// charter: mutation-invariants
// ADR-0184 Wave 1 skeleton — gossip invariants land alongside the Wave 4 port.
// Per ADR-0184 Open Follow-up #3, gossip invariants gate round-bound
// monotonicity (round-N+1 follows round-N) and settle-condition correctness
// (`coversAll` against canonical voter set) per ADR-0120 T2.

import type { Invariant } from '../../../registration.js';
import type { HiveMindConsensusPayload } from '../../../handlers/hive-mind/consensus.js';

export type { HiveMindConsensusPayload };

export const gossipConsensusInvariants: ReadonlyArray<Invariant<HiveMindConsensusPayload>> = [];
