// charter: mutation-invariants
// ADR-0184 Wave 1 skeleton — raft invariants land alongside the Wave 2 port.
// Per ADR-0184 Open Follow-up #3, raft invariants gate term monotonicity and
// `timeoutMs` well-formedness (ADR-0117).

import type { Invariant } from '../../../registration.js';
import type { HiveMindConsensusPayload } from '../../../handlers/hive-mind/consensus.js';

export type { HiveMindConsensusPayload };

export const raftConsensusInvariants: ReadonlyArray<Invariant<HiveMindConsensusPayload>> = [];
