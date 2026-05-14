// charter: dispatch
// autopilot_reset mutation handler (ADR-0180 Phase 5 wave 2, §Architecture · Audit chain).
// Registers as `GuardedWrite<AutopilotResetPayload>` so the reset transition
// (iterations=0, startTime=now, history=[], lastCheck=null, append 'reset'
// event) flows through the archivist's audit-chain with guard verdicts +
// invariant verdicts recorded.
//
// Backing files (FS-JSON family, ADR-0180 §10):
//   - `.claude-flow/data/autopilot-state.json` (state mutation)
//   - `.claude-flow/data/autopilot-log.json`   (event append)
// Both writes occur in the same withWrite scope so atomicity holds across the
// pair — a half-reset (state cleared but log entry missing, or vice versa) is
// prevented by the substrate's lock semantics.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/autopilot-tools.ts`
// `autopilot_reset` handler — loadState → reset 4 fields → saveState +
// appendLog. The cli callsite stays in place until the dispatch boundary is
// wired through cli (F4-3 deferral); this file establishes the registration
// shape.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `autopilot-state.json` may mutate.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/**
 * Mutation payload mirroring the CLI tool's `autopilot_reset` input shape
 * (autopilot-tools.ts inputSchema line 140 — empty properties). Reset takes
 * no parameters; the empty payload is preserved as a type so the dispatch
 * registry uniformly receives a payload object.
 */
export type AutopilotResetPayload = Record<string, never>;

const STORE_ID = 'autopilot_reset' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of autopilot-tools.ts
// `autopilot_reset` callsite once the dispatch boundary is wired through
// cli. The wrapper-in-cli pattern (loadState → zero iterations/startTime/
// history/lastCheck → saveState → appendLog) collapses to a single
// `ctx.substrate.withWrite` here.
export const resetAutopilotHandler: GuardedWrite<AutopilotResetPayload> =
  registerMutationHandler<AutopilotResetPayload>(
    'autopilot_reset',
    async (ctx: MutationContext<false>, _payload: AutopilotResetPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: autopilot_reset handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/autopilot-tools.ts ' +
          '\'autopilot_reset\' handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );
