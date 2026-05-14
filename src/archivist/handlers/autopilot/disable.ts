// charter: dispatch
// autopilot_disable mutation handler (ADR-0180 Phase 5 wave 2, §Architecture · Audit chain).
// Registers as `GuardedWrite<AutopilotDisablePayload>` so the disable
// transition (sets `enabled=false`, appends a 'disabled' event with current
// iteration count to the log) flows through the archivist's audit-chain with
// guard verdicts + invariant verdicts recorded.
//
// Backing files (FS-JSON family, ADR-0180 §10):
//   - `.claude-flow/data/autopilot-state.json` (state mutation)
//   - `.claude-flow/data/autopilot-log.json`   (event append)
// Both are owned by `autopilot_*` mutators and registered under a single
// STORE_ID per tool name.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/autopilot-tools.ts`
// `autopilot_disable` handler — loadState → mutate enabled → saveState +
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
 * Mutation payload mirroring the CLI tool's `autopilot_disable` input shape
 * (autopilot-tools.ts inputSchema line 98 — empty properties). Disable takes
 * no parameters; the empty payload is preserved as a type so the dispatch
 * registry uniformly receives a payload object.
 */
export type AutopilotDisablePayload = Record<string, never>;

const STORE_ID = 'autopilot_disable' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of autopilot-tools.ts
// `autopilot_disable` callsite once the dispatch boundary is wired through
// cli. The wrapper-in-cli pattern (loadState → mutate enabled=false →
// saveState → appendLog with iterations) collapses to a single
// `ctx.substrate.withWrite` here.
export const disableAutopilotHandler: GuardedWrite<AutopilotDisablePayload> =
  registerMutationHandler<AutopilotDisablePayload>(
    'autopilot_disable',
    async (ctx: MutationContext<false>, _payload: AutopilotDisablePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: autopilot_disable handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/autopilot-tools.ts ' +
          '\'autopilot_disable\' handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );
