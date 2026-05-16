// charter: mutation-invariants
// hook_session_end mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { SessionEndPayload } from '../../handlers/hooks/session-end.js';

export type { SessionEndPayload };

/** timestamp must be a finite non-negative number. */
const timestampNonNegative: Invariant<SessionEndPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.timestamp;
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    return { violated: true, detail: `timestamp must be a finite number, got ${String(t)}` };
  }
  if (t < 0) {
    return { violated: true, detail: `timestamp must be >= 0, got ${t}` };
  }
  return 'pass';
};

/** reason must be the literal 'session-end'. */
const reasonIsSessionEnd: Invariant<SessionEndPayload> = ({ recordedPayload }) => {
  if (recordedPayload.reason !== 'session-end') {
    return { violated: true, detail: `reason must be 'session-end', got ${JSON.stringify(recordedPayload.reason)}` };
  }
  return 'pass';
};

/** sessionId, when present, must be a non-empty string. */
const sessionIdWellFormed: Invariant<SessionEndPayload> = ({ recordedPayload }) => {
  const s = recordedPayload.sessionId;
  if (s === null) return 'pass';
  if (typeof s !== 'string' || s.length === 0) {
    return { violated: true, detail: `sessionId must be a non-empty string or null, got ${typeof s} length=${(s as string)?.length ?? 0}` };
  }
  return 'pass';
};

export const sessionEndInvariants: ReadonlyArray<Invariant<SessionEndPayload>> = [
  timestampNonNegative,
  reasonIsSessionEnd,
  sessionIdWellFormed,
];
