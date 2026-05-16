// charter: mutation-invariants
// agentdb_embed read-handler invariants (ADR-0181 §H).
// READ handler — RegisterReadOpts doesn't accept invariants today, so these
// ship as the contract spec. TODO(ADR-0180 §Read-path return shape):
// add embedding-vector well-formedness guards (finite values, expected
// dimension) when the return-shape invariant design lands.

import type { Invariant } from '../../registration.js';
import type { AgentdbEmbedQuery } from '../../handlers/agentdb/embed.js';

export type { AgentdbEmbedQuery };

const TEXT_MAX = 100_000;

const textWellFormed: Invariant<AgentdbEmbedQuery> = ({ recordedPayload }) => {
  const t = recordedPayload.text;
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `text must be a non-empty string, got ${typeof t} length=${(t as string)?.length ?? 0}` };
  }
  if (t.length > TEXT_MAX) {
    return { violated: true, detail: `text length ${t.length} exceeds max ${TEXT_MAX}` };
  }
  return 'pass';
};

export const embedInvariants: ReadonlyArray<Invariant<AgentdbEmbedQuery>> = [
  textWellFormed,
];
