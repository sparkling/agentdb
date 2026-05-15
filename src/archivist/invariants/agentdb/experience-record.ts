// charter: mutation-invariants
// agentdb_experience_record mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// LearningSystem episodes feed Decision Transformer / Q-learning replay; corrupt records
// (empty task, out-of-range reward, oversized input/output) poison the offline RL pipeline.

import type { Invariant } from '../../registration.js';
import type { AgentdbExperienceRecordPayload } from '../../handlers/agentdb/experience-record.js';

export type { AgentdbExperienceRecordPayload };

const TASK_MAX = 10_000;
const STRING_MAX = 100_000;

/** task must be a non-empty string ≤10KB. The cli enforces this; we re-check
 *  here for non-cli callers. */
const taskWellFormed: Invariant<AgentdbExperienceRecordPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.task;
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `task must be a non-empty string, got ${typeof t} length=${(t as string)?.length ?? 0}` };
  }
  if (t.length > TASK_MAX) {
    return { violated: true, detail: `task length ${t.length} exceeds max ${TASK_MAX}` };
  }
  return 'pass';
};

/** task identity — substrate writes the value as the `action` column on
 *  `learning_experiences`; divergence corrupts the replay key. */
const taskEquality: Invariant<AgentdbExperienceRecordPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.task !== recordedPayload.task) {
    return {
      violated: true,
      detail: `task divergence: intent.length=${callerIntent.task?.length ?? 0} recorded.length=${recordedPayload.task?.length ?? 0}`,
    };
  }
  return 'pass';
};

/** reward in [0,1] when present (LearningSystem normalizes rewards into this range). */
const rewardInRange: Invariant<AgentdbExperienceRecordPayload> = ({ recordedPayload }) => {
  const r = recordedPayload.reward;
  if (r === undefined || r === null) return 'pass';
  if (typeof r !== 'number' || !Number.isFinite(r)) {
    return { violated: true, detail: `reward must be a finite number, got ${String(r)}` };
  }
  if (r < 0 || r > 1) {
    return { violated: true, detail: `reward must be in [0,1], got ${r}` };
  }
  return 'pass';
};

/** input/output length bounded — keeps the SQLite row from growing unbounded. */
const inputOutputBounded: Invariant<AgentdbExperienceRecordPayload> = ({ recordedPayload }) => {
  const i = recordedPayload.input;
  const o = recordedPayload.output;
  if (typeof i === 'string' && i.length > STRING_MAX) {
    return { violated: true, detail: `input length ${i.length} exceeds max ${STRING_MAX}` };
  }
  if (typeof o === 'string' && o.length > STRING_MAX) {
    return { violated: true, detail: `output length ${o.length} exceeds max ${STRING_MAX}` };
  }
  return 'pass';
};

export const experienceRecordInvariants: ReadonlyArray<Invariant<AgentdbExperienceRecordPayload>> = [
  taskWellFormed,
  taskEquality,
  rewardInRange,
  inputOutputBounded,
];
