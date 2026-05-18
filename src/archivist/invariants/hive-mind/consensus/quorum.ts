// charter: mutation-invariants
// ADR-0184 Wave 1 skeleton — quorum invariants land alongside the Wave 2 port.
// Per ADR-0184 Open Follow-up #3, quorum invariants gate `quorumPreset` enum
// well-formedness + threshold-preset arithmetic.

import type { Invariant } from '../../../registration.js';
import type { HiveMindConsensusPayload } from '../../../handlers/hive-mind/consensus.js';

export type { HiveMindConsensusPayload };

export const quorumConsensusInvariants: ReadonlyArray<Invariant<HiveMindConsensusPayload>> = [];
