// charter: mutation-invariants
// daemon_runMap mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { MapWorkerPayload } from '../../handlers/daemons/map.js';

export type { MapWorkerPayload };

const PROJECT_ROOT_MAX = 4096;

const timestampNonEmpty: Invariant<MapWorkerPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.timestamp;
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `timestamp must be a non-empty string, got ${typeof t}` };
  }
  return 'pass';
};

const projectRootWellFormed: Invariant<MapWorkerPayload> = ({ recordedPayload }) => {
  const p = recordedPayload.projectRoot;
  if (typeof p !== 'string' || p.length === 0) {
    return { violated: true, detail: `projectRoot must be a non-empty string, got ${typeof p}` };
  }
  if (p.length > PROJECT_ROOT_MAX) {
    return { violated: true, detail: `projectRoot length ${p.length} exceeds max ${PROJECT_ROOT_MAX}` };
  }
  return 'pass';
};

const scannedAtNonNegative: Invariant<MapWorkerPayload> = ({ recordedPayload }) => {
  const s = recordedPayload.scannedAt;
  if (typeof s !== 'number' || !Number.isFinite(s)) {
    return { violated: true, detail: `scannedAt must be a finite number, got ${String(s)}` };
  }
  if (s < 0) {
    return { violated: true, detail: `scannedAt must be >= 0, got ${s}` };
  }
  return 'pass';
};

export const mapInvariants: ReadonlyArray<Invariant<MapWorkerPayload>> = [
  timestampNonEmpty,
  projectRootWellFormed,
  scannedAtNonNegative,
];
