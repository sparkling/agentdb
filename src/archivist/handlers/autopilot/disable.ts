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
} from '../../index.js';
import {
  AUTOPILOT_STORE_ID,
  AUTOPILOT_STATE_KEY,
  AUTOPILOT_LOG_KEY,
  appendLogEntry,
  readAutopilotLog,
  readAutopilotState,
} from './shared.js';

/**
 * Mutation payload mirroring the CLI tool's `autopilot_disable` input shape
 * (autopilot-tools.ts inputSchema line 98 — empty properties). Disable takes
 * no parameters; the empty payload is preserved as a type so the dispatch
 * registry uniformly receives a payload object.
 */
export type AutopilotDisablePayload = Record<string, never>;

// Ports autopilot-tools.ts `autopilot_disable` (loadState → enabled=false →
// saveState → appendLog 'disabled' with the current iteration count). The
// cli's `loadState` / `saveState` / `appendLog` triple collapses to a single
// `ctx.substrate.withWrite` — state save + log append in one lock scope.
export const disableAutopilotHandler: GuardedWrite<AutopilotDisablePayload> =
  registerMutationHandler<AutopilotDisablePayload>(
    'autopilot_disable',
    async (ctx: MutationContext<false>, _payload: AutopilotDisablePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: AUTOPILOT_STORE_ID }, async (handle) => {
        const state = await readAutopilotState(handle);
        const log = await readAutopilotLog(handle);

        state.enabled = false;

        const nextLog = appendLogEntry(log, {
          ts: Date.now(),
          event: 'disabled',
          iterations: state.iterations,
        });

        await handle.write({ storeId: AUTOPILOT_STORE_ID, key: AUTOPILOT_STATE_KEY, payload: state });
        await handle.write({ storeId: AUTOPILOT_STORE_ID, key: AUTOPILOT_LOG_KEY, payload: nextLog });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );
