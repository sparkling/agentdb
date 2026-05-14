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

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/**
 * Mutation payload mirroring the CLI tool's `autopilot_enable` input shape
 * (autopilot-tools.ts inputSchema lines 52-57). `mode` is an optional tag
 * string; when provided it must be a non-empty string (validated at cli today,
 * to be promoted to a typed invariant under Phase 5 wire-up).
 */
export interface AutopilotEnablePayload {
  readonly mode?: string;
}

const STORE_ID = 'autopilot_enable' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of autopilot-tools.ts
// `autopilot_enable` callsite once the dispatch boundary is wired through cli.
// The wrapper-in-cli pattern (loadState → mutate enabled/startTime/iterations
// → saveState → appendLog) collapses to a single `ctx.substrate.withWrite`
// here because `makeFsJsonSubstrate` owns the lock semantics. The appendLog
// becomes a second write inside the same withWrite scope.
export const enableAutopilotHandler: GuardedWrite<AutopilotEnablePayload> =
  registerMutationHandler<AutopilotEnablePayload>(
    'autopilot_enable',
    async (ctx: MutationContext<false>, _payload: AutopilotEnablePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: autopilot_enable handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/autopilot-tools.ts ' +
          '\'autopilot_enable\' handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );
