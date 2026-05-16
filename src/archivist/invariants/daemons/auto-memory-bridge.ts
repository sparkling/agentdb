// charter: mutation-invariants
// auto_memory_bridge mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { AutoMemoryBridgePayload } from '../../handlers/daemons/auto-memory-bridge.js';

export type { AutoMemoryBridgePayload };

const VALID_TRIGGERS = new Set(['periodic', 'on-session-end', 'on-write']);

const triggerInEnum: Invariant<AutoMemoryBridgePayload> = ({ recordedPayload }) => {
  if (!VALID_TRIGGERS.has(recordedPayload.trigger as string)) {
    return { violated: true, detail: `trigger must be one of {periodic,on-session-end,on-write}, got ${JSON.stringify(recordedPayload.trigger)}` };
  }
  return 'pass';
};

/** sinceMs must be a finite non-negative number. */
const sinceMsNonNegative: Invariant<AutoMemoryBridgePayload> = ({ recordedPayload }) => {
  const s = recordedPayload.sinceMs;
  if (typeof s !== 'number' || !Number.isFinite(s)) {
    return { violated: true, detail: `sinceMs must be a finite number, got ${String(s)}` };
  }
  if (s < 0) {
    return { violated: true, detail: `sinceMs must be >= 0, got ${s}` };
  }
  return 'pass';
};

/** ts must be a finite non-negative number (epoch ms). */
const tsNonNegative: Invariant<AutoMemoryBridgePayload> = ({ recordedPayload }) => {
  const t = recordedPayload.ts;
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    return { violated: true, detail: `ts must be a finite number, got ${String(t)}` };
  }
  if (t < 0) {
    return { violated: true, detail: `ts must be >= 0, got ${t}` };
  }
  return 'pass';
};

/** result.synced must be a non-negative number when present. */
const resultSyncedNonNegative: Invariant<AutoMemoryBridgePayload> = ({ recordedPayload }) => {
  const s = recordedPayload.result?.synced;
  if (s === undefined) return 'pass';
  if (typeof s !== 'number' || !Number.isFinite(s) || s < 0) {
    return { violated: true, detail: `result.synced must be a finite non-negative number, got ${String(s)}` };
  }
  return 'pass';
};

export const autoMemoryBridgeInvariants: ReadonlyArray<Invariant<AutoMemoryBridgePayload>> = [
  triggerInEnum,
  sinceMsNonNegative,
  tsNonNegative,
  resultSyncedNonNegative,
];
