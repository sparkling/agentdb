// charter: dispatch
// autopilot_learn mutation handler (ADR-0180 Phase 5 wave 2, §Architecture · Audit chain).
// Registers as `GuardedWrite<AutopilotLearnPayload>` so success-pattern
// discovery (which materializes AgentDB-backed pattern records via
// `AutopilotLearning.getMetrics()` + `.discoverSuccessPatterns()`) flows
// through the archivist's audit-chain with guard verdicts + invariant
// verdicts recorded.
//
// Why this is classified as a mutator (verified via handler-body inspection
// per ADR-0180 Phase 5 wave-2 brief):
//   - The cli handler at autopilot-tools.ts:202-212 calls
//     `tryLoadLearning()` → on success, awaits `getMetrics()` +
//     `discoverSuccessPatterns()` on the `AutopilotLearning` instance.
//   - `AutopilotLearning` (agentic-flow/dist/coordination/autopilot-learning.js)
//     is AgentDB-backed; pattern discovery writes derived pattern records
//     and updates metrics counters. Even though the surface return is a
//     read-shape, the underlying side-effects make this a mutation surface
//     per the audit-chain definition.
//   - On unavailable-learning fallback (no AgentDB), the handler returns a
//     neutral `{ available: false }` — still flows through the mutation
//     registration so there is exactly one registry entry per cli tool name.
//
// Backing store (not a single FS-JSON file unlike the other autopilot_*
// handlers — learn is the outlier): AgentDB-managed pattern store under
// `agentic-flow/coordination/autopilot-learning`. The substrate-seam
// abstracts this; the STORE_ID identifies the dispatch target, not a file.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/autopilot-tools.ts`
// `autopilot_learn` handler — tryLoadLearning → Promise.all(getMetrics,
// discoverSuccessPatterns) → ok. The cli callsite stays in place until the
// dispatch boundary is wired through cli (F4-3 deferral); this file
// establishes the registration shape.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// the learning pattern store may mutate.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/**
 * Mutation payload mirroring the CLI tool's `autopilot_learn` input shape
 * (autopilot-tools.ts inputSchema line 201 — empty properties). Learn takes
 * no parameters; the empty payload is preserved as a type so the dispatch
 * registry uniformly receives a payload object.
 */
export type AutopilotLearnPayload = Record<string, never>;

const STORE_ID = 'autopilot_learn' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of autopilot-tools.ts
// `autopilot_learn` callsite once the dispatch boundary is wired through
// cli. The wrapper-in-cli pattern (tryLoadLearning → if available run
// getMetrics + discoverSuccessPatterns in parallel → return; if unavailable
// return neutral) collapses into a `ctx.substrate.withWrite` here, with the
// substrate seam abstracting the AgentDB vs no-AgentDB distinction.
export const learnAutopilotHandler: GuardedWrite<AutopilotLearnPayload> =
  registerMutationHandler<AutopilotLearnPayload>(
    'autopilot_learn',
    async (ctx: MutationContext<false>, _payload: AutopilotLearnPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: autopilot_learn handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/autopilot-tools.ts ' +
          '\'autopilot_learn\' handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );
