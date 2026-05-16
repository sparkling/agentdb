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

import { registerMutationHandler } from '../../registration.js';
import type { MutationContext } from '../../mutation-context.js';
import type { GuardedWrite } from '../../types.js';
import { resetInvariants } from '../../invariants/autopilot/reset.js';
import {
  AUTOPILOT_STORE_ID,
  AUTOPILOT_STATE_KEY,
  AUTOPILOT_LOG_KEY,
  appendLogEntry,
  readAutopilotLog,
  readAutopilotState,
} from './shared.js';

/**
 * Mutation payload mirroring the CLI tool's `autopilot_reset` input shape
 * (autopilot-tools.ts inputSchema line 140 — empty properties). Reset takes
 * no parameters; the empty payload is preserved as a type so the dispatch
 * registry uniformly receives a payload object.
 */
export type AutopilotResetPayload = Record<string, never>;

// Ports autopilot-tools.ts `autopilot_reset` (loadState → iterations=0,
// startTime=now, history=[], lastCheck=null → saveState → appendLog 'reset').
// The cli's `loadState` / `saveState` / `appendLog` triple collapses to a
// single `ctx.substrate.withWrite` — the four zeroed fields and the matching
// log entry land atomically in one lock scope.
export const resetAutopilotHandler: GuardedWrite<AutopilotResetPayload> =
  registerMutationHandler<AutopilotResetPayload>(
    'autopilot_reset',
    async (ctx: MutationContext<false>, _payload: AutopilotResetPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: AUTOPILOT_STORE_ID }, async (handle) => {
        const state = await readAutopilotState(handle);
        const log = await readAutopilotLog(handle);

        state.iterations = 0;
        state.startTime = Date.now();
        state.history = [];
        state.lastCheck = null;

        const nextLog = appendLogEntry(log, { ts: Date.now(), event: 'reset' });

        await handle.write({ storeId: AUTOPILOT_STORE_ID, key: AUTOPILOT_STATE_KEY, payload: state });
        await handle.write({ storeId: AUTOPILOT_STORE_ID, key: AUTOPILOT_LOG_KEY, payload: nextLog });
      });
    },
    {
      invariants: resetInvariants,
      cacheScope: 'namespace',
    },
  );
