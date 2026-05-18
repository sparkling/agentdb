// charter: mutation-invariants
// ADR-0184 Wave 1 skeleton — bft invariants land alongside the Wave 2 port.
// Per ADR-0184 Open Follow-up #3, bft invariants gate the f+1-of-2f+1 voting
// threshold + equivocation detection (cli ~2436-2475 byzantineVoters scan).
//
// The parent dispatcher (handlers/hive-mind/consensus.ts) mutates
// `payload.strategy = 'bft'` before dispatch (mirroring cli line 2056), so
// every invariant here may safely match on `payload.strategy === 'bft'` alone —
// `'byzantine'` carry-forward is already normalised at handler entry.

import type { Invariant } from '../../../registration.js';
import type { HiveMindConsensusPayload } from '../../../handlers/hive-mind/consensus.js';

export type { HiveMindConsensusPayload };

export const bftConsensusInvariants: ReadonlyArray<Invariant<HiveMindConsensusPayload>> = [];
