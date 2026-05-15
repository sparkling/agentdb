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
} from '../../index.js';
import { emptyDaaStore, type DaaStore } from './agent-create.js';

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

// Body ported from daa-tools.ts `daa_agent_adapt` handler (lines 230-256):
// load store → reject if agent missing → adaptations++ → successRate =
// (current + score) / 2 → lastActivity = now → status = 'active' → save.
// The cli's outer `withDAALock` collapses into the single
// `ctx.substrate.withWrite` because the substrate primitive owns the lock
// semantics.
//
// SCOPE NOTE (updated post-Phase 5): the cli's prior post-lock
// `routeMemoryOp('store', namespace 'daa-feedback')` tail-call (formerly at
// daa-tools.ts:262-277) was DELETED in Phase 5 (`feedback-no-fallbacks` —
// the try/catch silently swallowed every cross-substrate write error). The
// cli code at daa-tools.ts:283-291 documents the deletion. The JSON-store
// metrics mutation below is now the SOLE write for this handler.
//
// ADR-0181 Phase 5 DA-memo CF#2: a future vector-searchable adaptation-event
// index belongs in the archivist as either:
//   (a) a registered handler invariant on this handler that mirrors the
//       applied state into a vector substrate (audit-chain native, single
//       intent → applied transition), OR
//   (b) a separate registered mutation (`daa_adaptation_event_record` or
//       similar) dispatched by callers that want the cross-substrate write,
//       composed at the cli boundary using two dispatches that the audit
//       chain ties to one parent context.
//
// Either path is its own design scope (cross-substrate semantics — fail-loud
// vs eventual-consistency, batch vs synchronous, key-collation strategy)
// and not part of the Phase 5 closure. NOT a try/catch wrapper at the cli
// boundary, ever — that's what was removed and why.
export const daaAgentAdaptHandler: GuardedWrite<DaaAgentAdaptPayload> =
  registerMutationHandler<DaaAgentAdaptPayload>(
    'daa_agent_adapt',
    async (ctx: MutationContext<false>, payload: DaaAgentAdaptPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<DaaStore>({ storeId: STORE_ID, key: 'root' });
        const store: DaaStore = current ?? emptyDaaStore();

        const agent = store.agents[payload.agentId];
        if (!agent) {
          throw new Error(
            `archivist: daa_agent_adapt — agent '${payload.agentId}' not found in daa store`,
          );
        }

        const performanceScore = payload.performanceScore ?? 0.8;
        agent.metrics.adaptations += 1;
        agent.metrics.successRate = (agent.metrics.successRate + performanceScore) / 2;
        agent.lastActivity = new Date().toISOString();
        agent.status = 'active';

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
