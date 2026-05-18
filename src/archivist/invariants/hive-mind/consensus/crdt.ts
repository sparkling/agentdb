// charter: mutation-invariants
// ADR-0184 Wave 1 skeleton — crdt invariants land alongside the Wave 5 port.
// Per ADR-0184 Open Follow-up #3, crdt invariants gate the CvRDT correctness
// triad (merge idempotency, commutativity, associativity) via sampled-property
// tests against G-Counter / OR-Set / LWW-Register per ADR-0121 T3.

import type { Invariant } from '../../../registration.js';
import type { HiveMindConsensusPayload } from '../../../handlers/hive-mind/consensus.js';

export type { HiveMindConsensusPayload };

export const crdtConsensusInvariants: ReadonlyArray<Invariant<HiveMindConsensusPayload>> = [];
