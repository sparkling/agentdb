// charter: mutation-invariants
// agentdb_skill_create mutation invariants (ADR-0181 §H).
// Mints a SkillLibrary entry. The cli validates name ≤500, description ≤10KB,
// success_rate via validateScore (default 0.5); these invariants enforce the
// shape at the dispatch boundary.

import type { Invariant } from '../../registration.js';
import type { AgentdbSkillCreatePayload } from '../../handlers/agentdb/skill-create.js';

export type { AgentdbSkillCreatePayload };

const NAME_MAX = 500;
const DESC_MAX = 10_000;
const CODE_MAX = 1_000_000;

/** name must be a non-empty string ≤500 chars. */
const nameWellFormed: Invariant<AgentdbSkillCreatePayload> = ({ recordedPayload }) => {
  const n = recordedPayload.name;
  if (typeof n !== 'string' || n.length === 0) {
    return { violated: true, detail: `name must be a non-empty string, got ${typeof n} length=${(n as string)?.length ?? 0}` };
  }
  if (n.length > NAME_MAX) {
    return { violated: true, detail: `name length ${n.length} exceeds max ${NAME_MAX}` };
  }
  return 'pass';
};

/** name identity — TAUTOLOGY today; ships as contract spec. */
const nameEquality: Invariant<AgentdbSkillCreatePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.name !== recordedPayload.name) {
    return {
      violated: true,
      detail: `name divergence: intent='${callerIntent.name}' recorded='${recordedPayload.name}'`,
    };
  }
  return 'pass';
};

const descriptionBoundedWhenPresent: Invariant<AgentdbSkillCreatePayload> = ({ recordedPayload }) => {
  const d = recordedPayload.description;
  if (d === undefined || d === null) return 'pass';
  if (typeof d !== 'string') {
    return { violated: true, detail: `description must be a string when present, got ${typeof d}` };
  }
  if (d.length > DESC_MAX) {
    return { violated: true, detail: `description length ${d.length} exceeds max ${DESC_MAX}` };
  }
  return 'pass';
};

const codeBoundedWhenPresent: Invariant<AgentdbSkillCreatePayload> = ({ recordedPayload }) => {
  const c = recordedPayload.code;
  if (c === undefined || c === null) return 'pass';
  if (typeof c !== 'string') {
    return { violated: true, detail: `code must be a string when present, got ${typeof c}` };
  }
  if (c.length > CODE_MAX) {
    return { violated: true, detail: `code length ${c.length} exceeds max ${CODE_MAX}` };
  }
  return 'pass';
};

/** success_rate (optional) must be finite ∈ [0, 1] when present (cli validateScore). */
const successRateInRangeWhenPresent: Invariant<AgentdbSkillCreatePayload> = ({ recordedPayload }) => {
  const s = recordedPayload.success_rate;
  if (s === undefined || s === null) return 'pass';
  if (typeof s !== 'number' || !Number.isFinite(s)) {
    return { violated: true, detail: `success_rate must be a finite number when present, got ${String(s)}` };
  }
  if (s < 0 || s > 1) {
    return { violated: true, detail: `success_rate must be in [0,1], got ${s}` };
  }
  return 'pass';
};

export const skillCreateInvariants: ReadonlyArray<Invariant<AgentdbSkillCreatePayload>> = [
  nameWellFormed,
  nameEquality,
  descriptionBoundedWhenPresent,
  codeBoundedWhenPresent,
  successRateInRangeWhenPresent,
];
