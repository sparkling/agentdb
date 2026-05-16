// charter: mutation-invariants
// memory_bridge_status READ-handler invariants (ADR-0180 §Architecture · Mutation invariants).
//
// TODO(ADR-0181 #104): read handlers don't accept an `invariants:` opt today.

import type { Invariant } from '../../registration.js';
import type { MemoryBridgeStatusQuery } from '../../handlers/memory/bridge-status.js';

export type { MemoryBridgeStatusQuery };

/** detail, when present, must be 'brief' or 'verbose'. */
const detailInEnum: Invariant<MemoryBridgeStatusQuery> = ({ recordedPayload }) => {
  const d = recordedPayload.detail;
  if (d === undefined) return 'pass';
  if (d !== 'brief' && d !== 'verbose') {
    return { violated: true, detail: `detail must be 'brief' or 'verbose', got ${JSON.stringify(d)}` };
  }
  return 'pass';
};

export const bridgeStatusInvariants: ReadonlyArray<Invariant<MemoryBridgeStatusQuery>> = [
  detailInEnum,
];
