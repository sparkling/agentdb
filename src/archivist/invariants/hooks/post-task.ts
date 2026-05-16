// charter: mutation-invariants
// hook_post_task mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// Handler is a stub today (throws); invariants ship as the contract spec for
// the boostConfidence semantics it will wire in Phase 5+.

import type { Invariant } from '../../registration.js';
import type { PostTaskPayload } from '../../handlers/hooks/post-task.js';

export type { PostTaskPayload };

const PATTERN_IDS_MAX = 1000;

/** success must be a boolean. */
const successBoolean: Invariant<PostTaskPayload> = ({ recordedPayload }) => {
  if (typeof recordedPayload.success !== 'boolean') {
    return { violated: true, detail: `success must be a boolean, got ${typeof recordedPayload.success}` };
  }
  return 'pass';
};

/** matchedPatternIds must be an array of non-empty strings (capped to prevent
 *  unbounded fan-out of confidence boost). */
const matchedPatternIdsWellFormed: Invariant<PostTaskPayload> = ({ recordedPayload }) => {
  const ids = recordedPayload.matchedPatternIds;
  if (!Array.isArray(ids)) {
    return { violated: true, detail: `matchedPatternIds must be an array, got ${typeof ids}` };
  }
  if (ids.length > PATTERN_IDS_MAX) {
    return { violated: true, detail: `matchedPatternIds length ${ids.length} exceeds max ${PATTERN_IDS_MAX}` };
  }
  for (let i = 0; i < ids.length; i++) {
    if (typeof ids[i] !== 'string' || (ids[i] as string).length === 0) {
      return { violated: true, detail: `matchedPatternIds[${i}] must be a non-empty string, got ${typeof ids[i]}` };
    }
  }
  return 'pass';
};

/** timestamp must be a finite non-negative number. */
const timestampNonNegative: Invariant<PostTaskPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.timestamp;
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    return { violated: true, detail: `timestamp must be a finite number, got ${String(t)}` };
  }
  if (t < 0) {
    return { violated: true, detail: `timestamp must be >= 0, got ${t}` };
  }
  return 'pass';
};

export const postTaskInvariants: ReadonlyArray<Invariant<PostTaskPayload>> = [
  successBoolean,
  matchedPatternIdsWellFormed,
  timestampNonNegative,
];
