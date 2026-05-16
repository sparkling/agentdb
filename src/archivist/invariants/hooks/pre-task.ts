// charter: mutation-invariants
// hook_pre_task mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// Hot-path handler; invariants are fast range/well-formedness checks only —
// the audit chain's microtask drain depends on cheap-to-evaluate predicates.

import type { Invariant } from '../../registration.js';
import type { PreTaskPayload } from '../../handlers/hooks/pre-task.js';

export type { PreTaskPayload };

const PROMPT_MAX = 100_000;
const TOOL_NAME_MAX = 200;

/** prompt must be a string ≤100KB (the FS-JSON document holds it). */
const promptBounded: Invariant<PreTaskPayload> = ({ recordedPayload }) => {
  const p = recordedPayload.prompt;
  if (typeof p !== 'string') {
    return { violated: true, detail: `prompt must be a string, got ${typeof p}` };
  }
  if (p.length > PROMPT_MAX) {
    return { violated: true, detail: `prompt length ${p.length} exceeds max ${PROMPT_MAX}` };
  }
  return 'pass';
};

/** toolName must be a non-empty string ≤200 chars. */
const toolNameWellFormed: Invariant<PreTaskPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.toolName;
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `toolName must be a non-empty string, got ${typeof t} length=${(t as string)?.length ?? 0}` };
  }
  if (t.length > TOOL_NAME_MAX) {
    return { violated: true, detail: `toolName length ${t.length} exceeds max ${TOOL_NAME_MAX}` };
  }
  return 'pass';
};

/** timestamp must be a finite non-negative number (epoch ms). */
const timestampNonNegative: Invariant<PreTaskPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.timestamp;
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    return { violated: true, detail: `timestamp must be a finite number, got ${String(t)}` };
  }
  if (t < 0) {
    return { violated: true, detail: `timestamp must be >= 0, got ${t}` };
  }
  return 'pass';
};

/** type must be the literal 'pre-task'. */
const typeIsPreTask: Invariant<PreTaskPayload> = ({ recordedPayload }) => {
  if (recordedPayload.type !== 'pre-task') {
    return { violated: true, detail: `type must be 'pre-task', got ${JSON.stringify(recordedPayload.type)}` };
  }
  return 'pass';
};

export const preTaskInvariants: ReadonlyArray<Invariant<PreTaskPayload>> = [
  promptBounded,
  toolNameWellFormed,
  timestampNonNegative,
  typeIsPreTask,
];
