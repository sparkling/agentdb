// charter: dispatch
// daa_agent_adapt mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<DaaAgentAdaptPayload>` so every adaptation transitions
// through the archivist's audit chain (intent → applied | rejected) with guard
// verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/daa-tools.ts` `daa_agent_adapt`
// handler — wraps load → mutate (agent.metrics.adaptations++, successRate avg,
// lastActivity, status='active') → save under `withDAALock` (ADR-0129 B1 —
// POSIX O_EXCL lockfile). A post-lock tail call routes the adaptation event
// through `routeMemoryOp` (namespace `daa-feedback`) for AgentDB pattern
// learning; that side-effect moves to a guarded post-write follow-up during
// wire-up (out of the substrate's withWrite scope so a memory-router failure
// cannot corrupt the agent metrics that already committed). cli callsites
// stay in place until the dispatch boundary is wired through cli. This file
// establishes the registration shape the dispatch path will resolve.
//
// FS-JSON store family: shares `.claude-flow/daa/store.json` with the other
// daa_* mutations — routed through `makeFsJsonSubstrate`.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// DAA state may mutate. Direct `fs.writeFileSync` on store.json is forbidden
// by the path-restricted substrate-internal.ts seam (ADR-0180 §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/**
 * Mutation payload mirroring the CLI tool's `daa_agent_adapt` input shape
 * (daa-tools.ts:216-224). Defaults applied at the wire-up callsite:
 * `performanceScore=0.8`.
 */
export interface DaaAgentAdaptPayload {
  readonly agentId: string;
  readonly feedback?: string;
  readonly performanceScore?: number;
  readonly suggestions?: ReadonlyArray<string>;
}

const STORE_ID = 'daa' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of daa-tools.ts
// `daa_agent_adapt` callsite (load store → reject if agent missing →
// adaptations++ → successRate = (current + score) / 2 → lastActivity = now →
// status = 'active' → save). The cli's outer `withDAALock` collapses to a
// single `ctx.substrate.withWrite` because the substrate primitive owns the
// lock semantics. The post-lock `routeMemoryOp('store', namespace
// 'daa-feedback')` tail-call becomes a guarded post-write follow-up — kept
// out of the withWrite scope so a memory-router miss does not roll back the
// already-committed agent metrics.
export const daaAgentAdaptHandler: GuardedWrite<DaaAgentAdaptPayload> =
  registerMutationHandler<DaaAgentAdaptPayload>(
    'daa_agent_adapt',
    async (ctx: MutationContext<false>, _payload: DaaAgentAdaptPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: daa_agent_adapt handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/daa-tools.ts daa_agent_adapt handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
