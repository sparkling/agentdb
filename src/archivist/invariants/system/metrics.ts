// charter: mutation-invariants
// system_metrics mutation invariants (ADR-0180 §Architecture · Mutation invariants).

import type { Invariant } from '../../registration.js';
import type { SystemMetricsPayload } from '../../handlers/system/metrics.js';

export type { SystemMetricsPayload };

const VALID_CATEGORIES = new Set(['all', 'cpu', 'memory', 'agents', 'tasks', 'requests']);
const VALID_FORMATS = new Set(['json', 'table', 'summary']);

/** category, when present, must be one of {all, cpu, memory, agents, tasks, requests}. */
const categoryInEnum: Invariant<SystemMetricsPayload> = ({ recordedPayload }) => {
  const c = recordedPayload.category;
  if (c === undefined) return 'pass';
  if (!VALID_CATEGORIES.has(c as string)) {
    return { violated: true, detail: `category must be one of {all,cpu,memory,agents,tasks,requests}, got ${JSON.stringify(c)}` };
  }
  return 'pass';
};

/** format, when present, must be one of {json, table, summary}. */
const formatInEnum: Invariant<SystemMetricsPayload> = ({ recordedPayload }) => {
  const f = recordedPayload.format;
  if (f === undefined) return 'pass';
  if (!VALID_FORMATS.has(f as string)) {
    return { violated: true, detail: `format must be one of {json,table,summary}, got ${JSON.stringify(f)}` };
  }
  return 'pass';
};

/** timeRange, when present, must be a non-empty string. */
const timeRangeWellFormed: Invariant<SystemMetricsPayload> = ({ recordedPayload }) => {
  const t = recordedPayload.timeRange;
  if (t === undefined) return 'pass';
  if (typeof t !== 'string' || t.length === 0) {
    return { violated: true, detail: `timeRange must be a non-empty string when present, got ${typeof t}` };
  }
  return 'pass';
};

export const metricsInvariants: ReadonlyArray<Invariant<SystemMetricsPayload>> = [
  categoryInEnum,
  formatInEnum,
  timeRangeWellFormed,
];
