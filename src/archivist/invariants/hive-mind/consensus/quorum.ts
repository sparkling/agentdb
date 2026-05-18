// charter: mutation-invariants
// ADR-0184 Wave 2 follow-up — quorum invariants stay empty until commit 2.3
// lands the real port. Per ADR-0184 Open Follow-up #3, quorum invariants
// gate payload well-formedness (quorumPreset enum, proposalId non-empty).

import type { Invariant } from '../../../registration.js';
import type { HiveMindConsensusPayload } from '../../../handlers/hive-mind/consensus.js';

export type { HiveMindConsensusPayload };

export const quorumConsensusInvariants: ReadonlyArray<Invariant<HiveMindConsensusPayload>> = [];
