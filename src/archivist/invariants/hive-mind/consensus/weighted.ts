// charter: mutation-invariants
// ADR-0184 Wave 1 skeleton — weighted invariants land alongside the Wave 3 port.
// Per ADR-0184 Open Follow-up #3, weighted invariants gate weight-sum
// validation (sum of weighted votes ≥ threshold; queen contributes
// QUEEN_WEIGHT, workers contribute 1) per ADR-0119 T1.

import type { Invariant } from '../../../registration.js';
import type { HiveMindConsensusPayload } from '../../../handlers/hive-mind/consensus.js';

export type { HiveMindConsensusPayload };

export const weightedConsensusInvariants: ReadonlyArray<Invariant<HiveMindConsensusPayload>> = [];
