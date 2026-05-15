// charter: dispatch
// autopilot_config mutation handler (ADR-0180 Phase 5 wave 2, §Architecture · Audit chain).
// Registers as `GuardedWrite<AutopilotConfigPayload>` so configuration
// mutations (maxIterations / timeoutMinutes / taskSources) flow through the
// archivist's audit-chain with guard verdicts + invariant verdicts recorded.
//
// Backing file (FS-JSON family, ADR-0180 §10):
//   - `.claude-flow/data/autopilot-state.json` (state mutation only — no log)
//
// Pre-existing CLI surface: `cli/src/mcp-tools/autopilot-tools.ts`
// `autopilot_config` handler — loadState → validateNumber/validateTaskSources
// per-field → saveState. The cli callsite stays in place until the dispatch
// boundary is wired through cli (F4-3 deferral); this file establishes the
// registration shape.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `autopilot-state.json` may mutate.
//
// Validation gates the invariants-author should encode (currently inline at
// cli per ADR-0082 / ADR-0094 P11/P12):
//   1. maxIterations: integer in [1, 1000]
//   2. timeoutMinutes: integer in [1, 1440]
//   3. taskSources: array of strings, each ∈ VALID_TASK_SOURCES
//      ('team-tasks', 'swarm-tasks', 'file-checklist')

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
} from '../../index.js';
import {
  AUTOPILOT_STORE_ID,
  AUTOPILOT_STATE_KEY,
  readAutopilotState,
  validateNumber,
  validateTaskSources,
} from './shared.js';

/** Valid task-source enum — matches `VALID_TASK_SOURCES` in autopilot-state.ts. */
export type AutopilotTaskSource = 'team-tasks' | 'swarm-tasks' | 'file-checklist';

/**
 * Mutation payload mirroring the CLI tool's `autopilot_config` input shape
 * (autopilot-tools.ts inputSchema lines 112-119). All fields optional; only
 * provided fields are validated and applied (partial-update semantics).
 */
export interface AutopilotConfigPayload {
  readonly maxIterations?: number;
  readonly timeoutMinutes?: number;
  readonly taskSources?: ReadonlyArray<AutopilotTaskSource>;
}

// Ports autopilot-tools.ts `autopilot_config` (loadState → per-provided-field
// validateNumber / validateTaskSources → saveState). No log append. The cli's
// `loadState` / `saveState` pair collapses to a single
// `ctx.substrate.withWrite`. `validateNumber` clamps an out-of-range input
// into `[min, max]` and falls back to the *current* value on a non-finite
// input — this is intentional clamping validation (the documented cli
// behaviour, ADR-0094 P11/P12), not a fault-masking fallback.
export const configAutopilotHandler: GuardedWrite<AutopilotConfigPayload> =
  registerMutationHandler<AutopilotConfigPayload>(
    'autopilot_config',
    async (ctx: MutationContext<false>, payload: AutopilotConfigPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: AUTOPILOT_STORE_ID }, async (handle) => {
        const state = await readAutopilotState(handle);

        if (payload.maxIterations !== undefined) {
          state.maxIterations = validateNumber(payload.maxIterations, 1, 1000, state.maxIterations);
        }
        if (payload.timeoutMinutes !== undefined) {
          state.timeoutMinutes = validateNumber(payload.timeoutMinutes, 1, 1440, state.timeoutMinutes);
        }
        if (payload.taskSources !== undefined) {
          state.taskSources = validateTaskSources(payload.taskSources);
        }

        await handle.write({ storeId: AUTOPILOT_STORE_ID, key: AUTOPILOT_STATE_KEY, payload: state });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );
