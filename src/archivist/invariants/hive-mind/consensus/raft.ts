// charter: mutation-invariants
// ADR-0184 Wave 2 follow-up — raft invariants stay empty until commit 2.2
// lands the real port. Per ADR-0184 Open Follow-up #3, raft invariants gate
// payload well-formedness (term positive integer, timeoutMs positive,
// proposalId non-empty).

import type { Invariant } from '../../../registration.js';
import type { HiveMindConsensusPayload } from '../../../handlers/hive-mind/consensus.js';

export type { HiveMindConsensusPayload };

export const raftConsensusInvariants: ReadonlyArray<Invariant<HiveMindConsensusPayload>> = [];
