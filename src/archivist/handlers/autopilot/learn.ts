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

import { registerMutationHandler } from '../../registration.js';
import type { MutationContext } from '../../mutation-context.js';
import type { GuardedWrite, StoreId } from '../../types.js';
import { learnInvariants } from '../../invariants/autopilot/learn.js';

/**
 * Mutation payload mirroring the CLI tool's `autopilot_learn` input shape
 * (autopilot-tools.ts inputSchema line 201 — empty properties). Learn takes
 * no parameters; the empty payload is preserved as a type so the dispatch
 * registry uniformly receives a payload object.
 */
export type AutopilotLearnPayload = Record<string, never>;

const STORE_ID = 'autopilot_learn' as StoreId;

// CARRY-FORWARD to Phase 5+ — ADR-0181 Phase 4 investigation outcome (2026-05-15).
//
// Investigated during Phase 4 F4-3-callsite alongside `agentdb_route`. Phase 4
// wires three narrow capabilities onto `MutationContext.capabilities`:
//   - `TaskRouter`         (capabilities.ts:42-58)  — adapts SemanticRouter
//                                                     `.route()` + LearningSystem
//                                                     `recommendAlgorithm` fallback
//   - `EmbeddingScorer`    (capabilities.ts:83-92)  — adapts `EmbeddingService.embed`
//   - `PatternReader`      (capabilities.ts:110-121) — adapts ReasoningBank's
//                                                     BM25 + semantic + RRF fusion
//                                                     over `reasoning_patterns`
//                                                     (read-side only)
//
// NONE of these is the capability `autopilot_learn` needs. Concrete missing
// dependency:
//
//   Requires an `AutopilotLearning` controller handle — the value
//   `tryLoadLearning()` returns at `cli/src/autopilot-state.ts:314-324`:
//     const mod = await import('agentic-flow/dist/coordination/autopilot-learning.js');
//     const instance = new mod.AutopilotLearning();
//     if (await instance.initialize()) return instance;
//   The cli handler at `cli/src/mcp-tools/autopilot-tools.ts:202-212` then
//   awaits `(learning).getMetrics()` + `(learning).discoverSuccessPatterns()`
//   on that instance. Both methods are arbitrary surface on `AutopilotLearning`,
//   NOT covered by any of `TaskRouter` / `EmbeddingScorer` / `PatternReader`:
//     - `taskRouter.route` is routing, not learning-metrics aggregation.
//     - `embeddingScorer.embed/cosineSimilarity` is vectorization, not pattern
//        discovery from episode metrics.
//     - `patternReader.searchPatterns` reads ReasoningBank's `reasoning_patterns`
//        SQLite table — a different data source than `AutopilotLearning`'s
//        AgentDB-managed pattern store (separate controller, separate methods,
//        separate persistence per learn.ts module header above).
//
// `AutopilotLearning` is also NOT on the PERMANENT_SQLITE_CARVE_OUT roster
// (substrate-registry.ts:88-94 — CausalRecall, CausalMemoryGraph,
// NightlyLearner, LearningSystem, ReasoningBank). The substrate seam alone
// therefore cannot reach it; a controller handle must be threaded.
//
// Mutation classification preserved: `AutopilotLearning.discoverSuccessPatterns()`
// materializes derived pattern records and updates metrics counters as
// side-effects (per learn.ts module header lines 14-21 above and the cli
// code's behavior), so the surface remains a `GuardedWrite` even though the
// return shape looks read-like. Reclassification to `GuardedRead` is incorrect.
//
// To un-stub in Phase 5+, ONE of:
//   (i) Add an `AutopilotLearner` narrow capability to capabilities.ts with
//       `{ getMetrics(): Promise<unknown>; discoverSuccessPatterns():
//         Promise<unknown> }`, plus `autopilotLearnerFactory` in
//       `CapabilityFactories`, plus wiring in `archivist-init.ts`. Handler
//       then calls `ctx.capabilities.requireAutopilotLearner()` like
//       `route.ts` does for `TaskRouter` / `EmbeddingScorer`.
//  (ii) Thread the `AutopilotLearning` instance directly through
//       `ArchivistInitConfig` (less aligned with the narrow-surface
//       capability discipline of ADR-0180 §Type enforcement; option (i) is
//       preferred).
export const learnAutopilotHandler: GuardedWrite<AutopilotLearnPayload> =
  registerMutationHandler<AutopilotLearnPayload>(
    'autopilot_learn',
    async (ctx: MutationContext<false>, _payload: AutopilotLearnPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: autopilot_learn carry-forward to Phase 5+ — requires an ' +
          'AutopilotLearning controller handle (from agentic-flow/dist/coordination/' +
          'autopilot-learning.js, instantiated by cli/src/autopilot-state.ts:314-324 ' +
          'tryLoadLearning()), exposing getMetrics() + discoverSuccessPatterns(). ' +
          'NOT in the Phase 4 F4-3-callsite capability set (TaskRouter / ' +
          'EmbeddingScorer / PatternReader) and NOT on the PERMANENT_SQLITE_CARVE_OUT ' +
          'roster. Un-stub path: add AutopilotLearner narrow capability to ' +
          'capabilities.ts + autopilotLearnerFactory in CapabilityFactories + ' +
          'archivist-init.ts wiring',
        );
      });
    },
    {
      invariants: learnInvariants,
      cacheScope: 'namespace',
    },
  );
