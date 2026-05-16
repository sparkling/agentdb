// charter: mutation-invariants
// progress_sync mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { ProgressSyncPayload } from '../../handlers/progress/sync.js';

export type { ProgressSyncPayload };

/** snapshot must be a plain object with the expected shape (domains/ddd/swarm). */
const snapshotWellFormed: Invariant<ProgressSyncPayload> = ({ recordedPayload }) => {
  const s = recordedPayload.snapshot;
  if (!s || typeof s !== 'object') {
    return { violated: true, detail: `snapshot must be an object, got ${typeof s}` };
  }
  if (!s.domains || typeof s.domains.completed !== 'number') {
    return { violated: true, detail: `snapshot.domains.completed must be a number` };
  }
  if (typeof s.domains.total !== 'number') {
    return { violated: true, detail: `snapshot.domains.total must be a number` };
  }
  return 'pass';
};

/** domains counters must be non-negative. */
const domainsNonNegative: Invariant<ProgressSyncPayload> = ({ recordedPayload }) => {
  const d = recordedPayload.snapshot?.domains;
  if (!d) return 'pass';
  if (typeof d.completed === 'number' && d.completed < 0) {
    return { violated: true, detail: `domains.completed must be >= 0, got ${d.completed}` };
  }
  if (typeof d.total === 'number' && d.total < 0) {
    return { violated: true, detail: `domains.total must be >= 0, got ${d.total}` };
  }
  if (typeof d.completed === 'number' && typeof d.total === 'number' && d.completed > d.total) {
    return { violated: true, detail: `domains.completed (${d.completed}) > domains.total (${d.total})` };
  }
  return 'pass';
};

/** swarm.activeAgents must be ≤ totalAgents when both present. */
const swarmAgentCountsOrdered: Invariant<ProgressSyncPayload> = ({ recordedPayload }) => {
  const sw = recordedPayload.snapshot?.swarm;
  if (!sw) return 'pass';
  if (typeof sw.activeAgents === 'number' && sw.activeAgents < 0) {
    return { violated: true, detail: `swarm.activeAgents must be >= 0, got ${sw.activeAgents}` };
  }
  if (typeof sw.totalAgents === 'number' && sw.totalAgents < 0) {
    return { violated: true, detail: `swarm.totalAgents must be >= 0, got ${sw.totalAgents}` };
  }
  if (typeof sw.activeAgents === 'number' && typeof sw.totalAgents === 'number' && sw.activeAgents > sw.totalAgents) {
    return { violated: true, detail: `swarm.activeAgents (${sw.activeAgents}) > totalAgents (${sw.totalAgents})` };
  }
  return 'pass';
};

export const syncInvariants: ReadonlyArray<Invariant<ProgressSyncPayload>> = [
  snapshotWellFormed,
  domainsNonNegative,
  swarmAgentCountsOrdered,
];
