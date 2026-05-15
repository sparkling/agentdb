// charter: dispatch
// Shared store shape + helpers for the four FS-JSON archivist autopilot_*
// mutation handlers (ADR-0180 Phase 5 wave 2 / ADR-0181 Phase 2).
//
// Mirrors `AutopilotState` / `AutopilotLogEntry` + the validation helpers from
// cli/src/autopilot-state.ts. The cli keeps state in
// `.claude-flow/data/autopilot-state.json` and the event log in
// `.claude-flow/data/autopilot-log.json` — two separate files. The archivist
// handlers fold both into ONE substrate store under two keys (`state`, `log`)
// so the state-save + log-append of `enable` / `disable` / `reset` happen in a
// single `ctx.substrate.withWrite` scope: a half-write (state cleared but log
// entry missing, or vice versa) is impossible.
//
// STORE_ID convention: all four FS-JSON autopilot_* handlers register under
// distinct cli tool names but share ONE `AUTOPILOT_STORE_ID` — they back the
// same autopilot state, so they must resolve to the same `SubstrateAccess`
// (one file, one lock). This mirrors the agents/* family, where the six
// `agent_*` handlers all use `STORE_ID = 'agent_spawn'`.
//
// `autopilot_learn` is NOT in this family — it is AgentDB-backed
// (`AutopilotLearning.discoverSuccessPatterns()`), not an FS-JSON file. See
// learn.ts for why it stays a Phase 3/4 carry-forward.

import { randomUUID } from 'node:crypto';
import type { StoreId } from '../../index.js';

/** Maximum entries kept in state.history — matches cli `MAX_HISTORY_ENTRIES`. */
export const MAX_HISTORY_ENTRIES = 50;

/** Maximum entries kept in the event log — matches cli `MAX_LOG_ENTRIES`. */
export const MAX_LOG_ENTRIES = 1000;

/** Allowlist for valid task sources — matches cli `VALID_TASK_SOURCES`. */
export const VALID_TASK_SOURCES: ReadonlySet<string> = new Set([
  'team-tasks',
  'swarm-tasks',
  'file-checklist',
]);

/** Autopilot persistent state — matches `AutopilotState` at autopilot-state.ts:36-46. */
export interface AutopilotState {
  sessionId: string;
  enabled: boolean;
  startTime: number;
  iterations: number;
  maxIterations: number;
  timeoutMinutes: number;
  taskSources: string[];
  lastCheck: number | null;
  history: Array<{ ts: number; iteration: number; completed: number; total: number }>;
}

/** Autopilot event-log entry — matches `AutopilotLogEntry` at autopilot-state.ts:48-52. */
export interface AutopilotLogEntry {
  ts: number;
  event: string;
  [key: string]: unknown;
}

/** Full autopilot substrate document — state + log folded into one record. */
export interface AutopilotStore {
  state: AutopilotState;
  log: AutopilotLogEntry[];
}

/**
 * Single shared `StoreId` for the FS-JSON autopilot_* family. `enable`,
 * `disable`, `config` and `reset` all back the one autopilot state document,
 * so they resolve to one `SubstrateAccess`.
 */
export const AUTOPILOT_STORE_ID = 'autopilot_enable' as StoreId;

/** Key for the state record inside the autopilot store. */
export const AUTOPILOT_STATE_KEY = 'state';

/** Key for the event-log record inside the autopilot store. */
export const AUTOPILOT_LOG_KEY = 'log';

/** Default state — mirrors `getDefaultState()` in the cli. */
export function getDefaultAutopilotState(): AutopilotState {
  return {
    sessionId: randomUUID(),
    enabled: false,
    startTime: Date.now(),
    iterations: 0,
    maxIterations: 50,
    timeoutMinutes: 240,
    taskSources: ['team-tasks', 'swarm-tasks', 'file-checklist'],
    lastCheck: null,
    history: [],
  };
}

/**
 * Validate and coerce a numeric parameter — ports the cli's `validateNumber`.
 * Returns the default when the input is non-finite, undefined, or null;
 * otherwise rounds and clamps into `[min, max]`.
 */
export function validateNumber(
  value: unknown,
  min: number,
  max: number,
  defaultValue: number,
): number {
  if (value === undefined || value === null) return defaultValue;
  const num = Number(value);
  if (!Number.isFinite(num)) return defaultValue;
  return Math.min(Math.max(min, Math.round(num)), max);
}

/**
 * Validate task sources against the allowlist — ports the cli's
 * `validateTaskSources`. Returns only valid sources; falls back to the full
 * default set if none are valid.
 */
export function validateTaskSources(sources: unknown): string[] {
  const defaults = ['team-tasks', 'swarm-tasks', 'file-checklist'];
  if (!Array.isArray(sources)) return defaults;
  const valid = sources
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => VALID_TASK_SOURCES.has(s));
  return valid.length > 0 ? valid : defaults;
}

/**
 * Read the autopilot state from the substrate handle, falling back to the cli
 * default + re-validating tamper-prone fields exactly as the cli's `loadState`
 * does. History is capped to `MAX_HISTORY_ENTRIES`.
 */
export async function readAutopilotState(
  handle: { read<R>(scope: { storeId: StoreId; key: string }): Promise<R | undefined> },
): Promise<AutopilotState> {
  const defaults = getDefaultAutopilotState();
  const stored = await handle.read<AutopilotState>({
    storeId: AUTOPILOT_STORE_ID,
    key: AUTOPILOT_STATE_KEY,
  });
  if (!stored) return defaults;

  const merged: AutopilotState = { ...defaults, ...stored };
  merged.maxIterations = validateNumber(merged.maxIterations, 1, 1000, 50);
  merged.timeoutMinutes = validateNumber(merged.timeoutMinutes, 1, 1440, 240);
  merged.iterations = validateNumber(merged.iterations, 0, 1000, 0);
  merged.taskSources = validateTaskSources(merged.taskSources);
  if (Array.isArray(merged.history) && merged.history.length > MAX_HISTORY_ENTRIES) {
    merged.history = merged.history.slice(-MAX_HISTORY_ENTRIES);
  }
  return merged;
}

/**
 * Read the autopilot event log from the substrate handle. Missing/non-array
 * stored value yields an empty log — matches the cli's `loadLog`.
 */
export async function readAutopilotLog(
  handle: { read<R>(scope: { storeId: StoreId; key: string }): Promise<R | undefined> },
): Promise<AutopilotLogEntry[]> {
  const stored = await handle.read<AutopilotLogEntry[]>({
    storeId: AUTOPILOT_STORE_ID,
    key: AUTOPILOT_LOG_KEY,
  });
  return Array.isArray(stored) ? stored : [];
}

/**
 * Append an entry to the event log and cap to `MAX_LOG_ENTRIES` — ports the
 * tail of the cli's `appendLog`.
 */
export function appendLogEntry(
  log: AutopilotLogEntry[],
  entry: AutopilotLogEntry,
): AutopilotLogEntry[] {
  const next = [...log, entry];
  return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
}
