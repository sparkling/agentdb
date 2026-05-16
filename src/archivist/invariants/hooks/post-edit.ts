// charter: mutation-invariants
// hook_post_edit mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// Hot-path handler; invariants must be cheap.

import type { Invariant } from '../../registration.js';
import type { PostEditPayload } from '../../handlers/hooks/post-edit.js';

export type { PostEditPayload };

const FILE_MAX = 4096; // POSIX PATH_MAX

/** file must be a non-empty string ≤PATH_MAX. */
const fileWellFormed: Invariant<PostEditPayload> = ({ recordedPayload }) => {
  const f = recordedPayload.file;
  if (typeof f !== 'string' || f.length === 0) {
    return { violated: true, detail: `file must be a non-empty string, got ${typeof f} length=${(f as string)?.length ?? 0}` };
  }
  if (f.length > FILE_MAX) {
    return { violated: true, detail: `file length ${f.length} exceeds max ${FILE_MAX}` };
  }
  return 'pass';
};

/** timestamp must be a finite non-negative number. */
const timestampNonNegative: Invariant<PostEditPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.timestamp;
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    return { violated: true, detail: `timestamp must be a finite number, got ${String(t)}` };
  }
  if (t < 0) {
    return { violated: true, detail: `timestamp must be >= 0, got ${t}` };
  }
  return 'pass';
};

/** type must be the literal 'edit'. */
const typeIsEdit: Invariant<PostEditPayload> = ({ recordedPayload }) => {
  if (recordedPayload.type !== 'edit') {
    return { violated: true, detail: `type must be 'edit', got ${JSON.stringify(recordedPayload.type)}` };
  }
  return 'pass';
};

export const postEditInvariants: ReadonlyArray<Invariant<PostEditPayload>> = [
  fileWellFormed,
  timestampNonNegative,
  typeIsEdit,
];
