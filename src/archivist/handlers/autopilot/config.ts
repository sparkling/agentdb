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
  type StoreId,
} from '../../index';

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

const STORE_ID = 'autopilot_config' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of autopilot-tools.ts
// `autopilot_config` callsite once the dispatch boundary is wired through
// cli. The wrapper-in-cli pattern (loadState → per-field validateNumber /
// validateTaskSources → saveState) collapses to a single
// `ctx.substrate.withWrite` here; the validateNumber/validateTaskSources
// gates should be promoted to typed invariants rather than inline guards.
export const configAutopilotHandler: GuardedWrite<AutopilotConfigPayload> =
  registerMutationHandler<AutopilotConfigPayload>(
    'autopilot_config',
    async (ctx: MutationContext<false>, _payload: AutopilotConfigPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: autopilot_config handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/autopilot-tools.ts ' +
          '\'autopilot_config\' handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );
