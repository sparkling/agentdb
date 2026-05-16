// charter: mutation-invariants
// agentdb_gnn_stats read-handler invariants (ADR-0181 §H).
// READ handler — RegisterReadOpts doesn't accept invariants today, so these
// ship as the contract spec. TODO(ADR-0180 §Read-path return shape):
// add post-dispatch result-shape guards (engine ∈ {native,js,unknown},
// count >= 0) when the return-shape invariant design lands.

import type { Invariant } from '../../registration.js';
import type { AgentdbGnnStatsQuery } from '../../handlers/agentdb/gnn-stats.js';

export type { AgentdbGnnStatsQuery };

const PATTERN_MAX = 10_000;
const TYPE_MAX = 200;

const patternBoundedWhenPresent: Invariant<AgentdbGnnStatsQuery> = ({ recordedPayload }) => {
  const p = recordedPayload.pattern;
  if (p === undefined || p === null) return 'pass';
  if (typeof p !== 'string') {
    return { violated: true, detail: `pattern must be a string when present, got ${typeof p}` };
  }
  if (p.length > PATTERN_MAX) {
    return { violated: true, detail: `pattern length ${p.length} exceeds max ${PATTERN_MAX}` };
  }
  return 'pass';
};

const typeBoundedWhenPresent: Invariant<AgentdbGnnStatsQuery> = ({ recordedPayload }) => {
  const t = recordedPayload.type;
  if (t === undefined || t === null) return 'pass';
  if (typeof t !== 'string') {
    return { violated: true, detail: `type must be a string when present, got ${typeof t}` };
  }
  if (t.length > TYPE_MAX) {
    return { violated: true, detail: `type length ${t.length} exceeds max ${TYPE_MAX}` };
  }
  return 'pass';
};

export const gnnStatsInvariants: ReadonlyArray<Invariant<AgentdbGnnStatsQuery>> = [
  patternBoundedWhenPresent,
  typeBoundedWhenPresent,
];
