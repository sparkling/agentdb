// charter: mutation-invariants
// daemon_runOptimize mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { OptimizeWorkerPayload } from '../../handlers/daemons/optimize.js';

export type { OptimizeWorkerPayload };

const VALID_MODES = new Set(['local', 'headless']);

const modeInEnum: Invariant<OptimizeWorkerPayload> = ({ recordedPayload }) => {
  if (!VALID_MODES.has(recordedPayload.mode as string)) {
    return { violated: true, detail: `mode must be 'local' or 'headless', got ${JSON.stringify(recordedPayload.mode)}` };
  }
  return 'pass';
};

const timestampNonEmpty: Invariant<OptimizeWorkerPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.timestamp;
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `timestamp must be a non-empty string, got ${typeof t}` };
  }
  return 'pass';
};

const uptimeNonNegative: Invariant<OptimizeWorkerPayload> = ({ recordedPayload }) => {
  const u = recordedPayload.uptime;
  if (typeof u !== 'number' || !Number.isFinite(u)) {
    return { violated: true, detail: `uptime must be a finite number, got ${String(u)}` };
  }
  if (u < 0) {
    return { violated: true, detail: `uptime must be >= 0, got ${u}` };
  }
  return 'pass';
};

/** optimizations.cacheHitRate must be in [0, 1]. */
const cacheHitRateInRange: Invariant<OptimizeWorkerPayload> = ({ recordedPayload }) => {
  const r = recordedPayload.optimizations?.cacheHitRate;
  if (r === undefined) return 'pass';
  if (typeof r !== 'number' || !Number.isFinite(r)) {
    return { violated: true, detail: `optimizations.cacheHitRate must be a finite number, got ${String(r)}` };
  }
  if (r < 0 || r > 1) {
    return { violated: true, detail: `optimizations.cacheHitRate must be in [0, 1], got ${r}` };
  }
  return 'pass';
};

export const optimizeInvariants: ReadonlyArray<Invariant<OptimizeWorkerPayload>> = [
  modeInEnum,
  timestampNonEmpty,
  uptimeNonNegative,
  cacheHitRateInRange,
];
