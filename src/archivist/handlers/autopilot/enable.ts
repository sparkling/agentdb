// charter: dispatch
// autopilot_enable mutation handler (ADR-0180 Phase 5 wave 2, §Architecture · Audit chain).
// Registers as `GuardedWrite<AutopilotEnablePayload>` so the enable transition
// (sets `enabled=true`, resets `startTime`/`iterations`, appends an 'enabled'
// event to the log) flows through the archivist's audit-chain with guard
// verdicts + invariant verdicts recorded.
//
// Backing files (FS-JSON family, ADR-0180 §10):
//   - `.claude-flow/data/autopilot-state.json` (state mutation)
//   - `.claude-flow/data/autopilot-log.json`   (event append)
// Both are owned by `autopilot_*` mutators and registered under a single
// STORE_ID per tool name. The log-append happens in the same withWrite scope
// as the state save so atomicity holds across the pair.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/autopilot-tools.ts`
// `autopilot_enable` handler — loadState → mutate → saveState + appendLog. The
// cli callsite stays in place until the dispatch boundary is wired through cli
// (F4-3 deferral); this file establishes the registration shape.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `autopilot-state.json` may mutate. The underlying primitive is
// `makeFsJsonSubstrate` (substrates/fs-json-store.ts), shared with the other
// `autopilot_*` mutation handlers in this directory.
//
// Mode parameter validation (ADR-0094 P11/P12 + ADR-0082): the cli-side
// `autopilot_enable` already type-checks `mode` loudly (non-string + empty
// string both produce `success:false` early returns). Phase 5 wire-up should
// preserve this; the invariants-author should encode the type/non-empty gate
// as a typed invariant rather than an inline early return.

import { registerMutationHandler } from '../../registration.js';
import type { MutationContext } from '../../mutation-context.js';
import type { GuardedWrite } from '../../types.js';
import { enableInvariants } from '../../invariants/autopilot/enable.js';
import {
  AUTOPILOT_STORE_ID,
  AUTOPILOT_STATE_KEY,
  AUTOPILOT_LOG_KEY,
  appendLogEntry,
  readAutopilotLog,
  readAutopilotState,
} from './shared.js';

/**
 * Mutation payload mirroring the CLI tool's `autopilot_enable` input shape
 * (autopilot-tools.ts inputSchema lines 52-57). `mode` is an optional tag
 * string; when provided it must be a non-empty string.
 */
export interface AutopilotEnablePayload {
  readonly mode?: string;
}

// Ports autopilot-tools.ts `autopilot_enable` (loadState → enabled=true,
// startTime=now, iterations=0 → saveState → appendLog 'enabled'). The cli's
// `loadState` / `saveState` / `appendLog` triple collapses to a single
// `ctx.substrate.withWrite`: the state save and the log append are two writes
// inside one lock scope, so `enabled=true` and the matching log entry land
// atomically. The cli's `mode` type-check (ADR-0082 / ADR-0094 P11/P12) moves
// to a fail-loud throw at the handler head — under the void-returning mutation
// contract an invalid payload is a thrown error, not a `success:false` shape.
export const enableAutopilotHandler: GuardedWrite<AutopilotEnablePayload> =
  registerMutationHandler<AutopilotEnablePayload>(
    'autopilot_enable',
    async (ctx: MutationContext<false>, payload: AutopilotEnablePayload): Promise<void> => {
      if (payload.mode !== undefined) {
        if (typeof payload.mode !== 'string') {
          throw new Error(
            `archivist: autopilot_enable 'mode' must be a string if provided ` +
            `(got ${JSON.stringify(payload.mode)})`,
          );
        }
        if (payload.mode.length === 0) {
          throw new Error(
            `archivist: autopilot_enable 'mode' must be a non-empty string if provided`,
          );
        }
      }

      await ctx.substrate.withWrite({ storeId: AUTOPILOT_STORE_ID }, async (handle) => {
        const state = await readAutopilotState(handle);
        const log = await readAutopilotLog(handle);

        state.enabled = true;
        state.startTime = Date.now();
        state.iterations = 0;

        const nextLog = appendLogEntry(log, {
          ts: Date.now(),
          event: 'enabled',
          sessionId: state.sessionId,
        });

        await handle.write({ storeId: AUTOPILOT_STORE_ID, key: AUTOPILOT_STATE_KEY, payload: state });
        await handle.write({ storeId: AUTOPILOT_STORE_ID, key: AUTOPILOT_LOG_KEY, payload: nextLog });
      });
    },
    {
      invariants: enableInvariants,
      cacheScope: 'namespace',
    },
  );
