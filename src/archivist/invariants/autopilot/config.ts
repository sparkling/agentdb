// charter: mutation-invariants
// autopilot_config mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler clamps `validateNumber` inside the body (ADR-0094 P11/P12); these
// invariants are the second correctness gate: they reject obviously broken values
// at the dispatch boundary BEFORE the clamp loses information.

import type { Invariant } from '../../registration.js';
import type { AutopilotConfigPayload } from '../../handlers/autopilot/config.js';

export type { AutopilotConfigPayload };

const VALID_TASK_SOURCES = new Set(['team-tasks', 'swarm-tasks', 'file-checklist']);
const MAX_ITER_RANGE = 1000;
const MAX_TIMEOUT_RANGE = 1440;

/** maxIterations, when present, must be a finite integer in [1, 1000]. The
 *  handler clamps, but a non-finite value would silently fall back to the
 *  existing state — surface it as a rejection instead. */
const maxIterationsInRange: Invariant<AutopilotConfigPayload> = ({ recordedPayload }) => {
  const v = recordedPayload.maxIterations;
  if (v === undefined) return 'pass';
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return { violated: true, detail: `maxIterations must be a finite number, got ${String(v)}` };
  }
  if (v < 1 || v > MAX_ITER_RANGE) {
    return { violated: true, detail: `maxIterations must be in [1, ${MAX_ITER_RANGE}], got ${v}` };
  }
  return 'pass';
};

/** timeoutMinutes, when present, must be a finite integer in [1, 1440]. */
const timeoutMinutesInRange: Invariant<AutopilotConfigPayload> = ({ recordedPayload }) => {
  const v = recordedPayload.timeoutMinutes;
  if (v === undefined) return 'pass';
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return { violated: true, detail: `timeoutMinutes must be a finite number, got ${String(v)}` };
  }
  if (v < 1 || v > MAX_TIMEOUT_RANGE) {
    return { violated: true, detail: `timeoutMinutes must be in [1, ${MAX_TIMEOUT_RANGE}], got ${v}` };
  }
  return 'pass';
};

/** taskSources, when present, must be an array of valid source strings. */
const taskSourcesInEnum: Invariant<AutopilotConfigPayload> = ({ recordedPayload }) => {
  const ts = recordedPayload.taskSources;
  if (ts === undefined) return 'pass';
  if (!Array.isArray(ts)) {
    return { violated: true, detail: `taskSources must be an array, got ${typeof ts}` };
  }
  for (let i = 0; i < ts.length; i++) {
    if (!VALID_TASK_SOURCES.has(ts[i] as string)) {
      return { violated: true, detail: `taskSources[${i}] must be one of {team-tasks,swarm-tasks,file-checklist}, got ${JSON.stringify(ts[i])}` };
    }
  }
  return 'pass';
};

export const configInvariants: ReadonlyArray<Invariant<AutopilotConfigPayload>> = [
  maxIterationsInRange,
  timeoutMinutesInRange,
  taskSourcesInEnum,
];
