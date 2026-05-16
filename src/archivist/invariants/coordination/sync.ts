// charter: mutation-invariants
// coordination_sync mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler mutates `store.sync.{syncCount,lastSync,pendingChanges,conflicts}`.
// Out-of-enum action / conflictResolution would skip the intended branch.

import type { Invariant } from '../../registration.js';
import type { CoordinationSyncPayload } from '../../handlers/coordination/sync.js';

export type { CoordinationSyncPayload };

const VALID_ACTIONS = new Set(['status', 'trigger', 'resolve']);
const VALID_RESOLUTIONS = new Set(['latest', 'merge', 'manual']);

/** action must be one of {status, trigger, resolve} when present. */
const actionInEnum: Invariant<CoordinationSyncPayload> = ({ recordedPayload }) => {
  const a = recordedPayload.action;
  if (a === undefined) return 'pass';
  if (!VALID_ACTIONS.has(a as string)) {
    return { violated: true, detail: `action must be one of {status,trigger,resolve}, got ${JSON.stringify(a)}` };
  }
  return 'pass';
};

/** conflictResolution, when present, must be one of {latest, merge, manual}. */
const conflictResolutionInEnum: Invariant<CoordinationSyncPayload> = ({ recordedPayload }) => {
  const c = recordedPayload.conflictResolution;
  if (c === undefined) return 'pass';
  if (!VALID_RESOLUTIONS.has(c as string)) {
    return { violated: true, detail: `conflictResolution must be one of {latest,merge,manual}, got ${JSON.stringify(c)}` };
  }
  return 'pass';
};

/** force, when present, must be a boolean. */
const forceBoolean: Invariant<CoordinationSyncPayload> = ({ recordedPayload }) => {
  const f = recordedPayload.force;
  if (f === undefined) return 'pass';
  if (typeof f !== 'boolean') {
    return { violated: true, detail: `force must be a boolean when present, got ${typeof f}` };
  }
  return 'pass';
};

/** action identity — TAUTOLOGY TODAY. */
const actionEquality: Invariant<CoordinationSyncPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.action !== recordedPayload.action) {
    return { violated: true, detail: `action divergence: intent='${String(callerIntent.action)}' recorded='${String(recordedPayload.action)}'` };
  }
  return 'pass';
};

export const syncInvariants: ReadonlyArray<Invariant<CoordinationSyncPayload>> = [
  actionInEnum,
  conflictResolutionInEnum,
  forceBoolean,
  actionEquality,
];
