// charter: mutation-invariants
// daemon_audit mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// Bad mode / missing timestamp would corrupt the security-audit snapshot.

import type { Invariant } from '../../registration.js';
import type { AuditWorkerPayload } from '../../handlers/daemons/audit.js';

export type { AuditWorkerPayload };

const VALID_MODES = new Set(['local', 'headless']);

/** mode must be 'local' or 'headless'. */
const modeInEnum: Invariant<AuditWorkerPayload> = ({ recordedPayload }) => {
  if (!VALID_MODES.has(recordedPayload.mode as string)) {
    return { violated: true, detail: `mode must be 'local' or 'headless', got ${JSON.stringify(recordedPayload.mode)}` };
  }
  return 'pass';
};

/** timestamp must be a non-empty ISO-8601 string. */
const timestampNonEmpty: Invariant<AuditWorkerPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.timestamp;
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `timestamp must be a non-empty string, got ${typeof t}` };
  }
  return 'pass';
};

export const auditInvariants: ReadonlyArray<Invariant<AuditWorkerPayload>> = [
  modeInEnum,
  timestampNonEmpty,
];
