// charter: mutation-invariants
// hive-mind_broadcast mutation invariants (ADR-0181 §H).
// Appends a typed entry to state.sharedMemory.broadcasts.value. Message
// must be a non-empty string; priority must be one of the four bands.

import type { Invariant } from '../../registration.js';
import type { HiveMindBroadcastPayload } from '../../handlers/hive-mind/broadcast.js';

export type { HiveMindBroadcastPayload };

const MESSAGE_MAX = 50_000;
const FROM_ID_MAX = 500;
const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'critical']);

/** message must be a non-empty string ≤50KB. */
const messageWellFormed: Invariant<HiveMindBroadcastPayload> = ({ recordedPayload }) => {
  const m = recordedPayload.message;
  if (typeof m !== 'string' || m.length === 0) {
    return { violated: true, detail: `message must be a non-empty string, got ${typeof m} length=${(m as string)?.length ?? 0}` };
  }
  if (m.length > MESSAGE_MAX) {
    return { violated: true, detail: `message length ${m.length} exceeds max ${MESSAGE_MAX}` };
  }
  return 'pass';
};

/** message identity — TAUTOLOGY today; ships as contract spec. */
const messageEquality: Invariant<HiveMindBroadcastPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.message !== recordedPayload.message) {
    return {
      violated: true,
      detail: `message divergence: intent.length=${callerIntent.message?.length ?? 0} recorded.length=${recordedPayload.message?.length ?? 0}`,
    };
  }
  return 'pass';
};

/** priority (optional) must be one of {low, normal, high, critical} when present. */
const priorityInEnumWhenPresent: Invariant<HiveMindBroadcastPayload> = ({ recordedPayload }) => {
  const p = recordedPayload.priority;
  if (p === undefined || p === null) return 'pass';
  if (typeof p !== 'string' || !VALID_PRIORITIES.has(p)) {
    return { violated: true, detail: `priority must be one of {low,normal,high,critical}, got ${JSON.stringify(p)}` };
  }
  return 'pass';
};

/** fromId (optional) must be a non-empty string ≤500 chars when present. */
const fromIdBoundedWhenPresent: Invariant<HiveMindBroadcastPayload> = ({ recordedPayload }) => {
  const f = recordedPayload.fromId;
  if (f === undefined || f === null) return 'pass';
  if (typeof f !== 'string' || f.length === 0) {
    return { violated: true, detail: `fromId must be a non-empty string when present, got ${typeof f} length=${(f as string)?.length ?? 0}` };
  }
  if (f.length > FROM_ID_MAX) {
    return { violated: true, detail: `fromId length ${f.length} exceeds max ${FROM_ID_MAX}` };
  }
  return 'pass';
};

export const broadcastInvariants: ReadonlyArray<Invariant<HiveMindBroadcastPayload>> = [
  messageWellFormed,
  messageEquality,
  priorityInEnumWhenPresent,
  fromIdBoundedWhenPresent,
];
