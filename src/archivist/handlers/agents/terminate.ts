// charter: dispatch
// agent_terminate mutation handler (ADR-0180 Phase 5 §Migration concerns).
// Registers as `GuardedWrite<AgentTerminatePayload>` so every termination
// transitions through the archivist's audit-chain (intent → applied | rejected)
// with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agent-tools.ts`
// `agent_terminate` handler — flips `store.agents[agentId].status` to
// `'terminated'` and persists via `saveAgentStore`. The cli callsite stays in
// place until the dispatch boundary is wired through cli (mirroring
// agent_spawn pending wire-up). This file establishes the registration shape
// the dispatch path will resolve.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `agents/store.json` mutations may run. Direct `fs.writeFileSync` on the
// file from store-tree code is forbidden by the `no-restricted-imports`
// backstop and the path-restricted substrate-internal.ts seam (ADR-0180
// §Type enforcement).

import { registerMutationHandler } from '../../registration.js';
import type {
  GuardedWrite,
  MutationContext,
  StoreId,
} from '../../index.js';
import type { AgentStore } from './spawn.js';
import { terminateInvariants } from '../../invariants/agents/terminate.js';

/**
 * Mutation payload mirroring the CLI tool's `agent_terminate` input shape
 * (agent-tools.ts:323-330). `force` is accepted for API compatibility but
 * the persisted state transition is identical (status → 'terminated');
 * `force` flips out-of-band cleanup behavior in cli — not substrate state.
 */
export interface AgentTerminatePayload {
  readonly agentId: string;
  readonly force?: boolean;
}

const STORE_ID = 'agent_spawn' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of agent-tools.ts
// `agent_terminate` callsite once the dispatch boundary is wired through cli.
// Body: read store → if agents[agentId] exists, mark `status='terminated'`
// → write store back. Missing-agent surfaces as a failed audit entry rather
// than a silent no-op (per `feedback-no-fallbacks`).
export const terminateAgentHandler: GuardedWrite<AgentTerminatePayload> =
  registerMutationHandler<AgentTerminatePayload>(
    'agent_terminate',
    async (ctx: MutationContext<false>, payload: AgentTerminatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<AgentStore>({
          storeId: STORE_ID,
          key: 'root',
        });
        if (!current || !current.agents[payload.agentId]) {
          throw new Error(`agent_terminate: agent '${payload.agentId}' not found`);
        }

        const existing = current.agents[payload.agentId];
        const next: AgentStore = {
          ...current,
          agents: {
            ...current.agents,
            [payload.agentId]: { ...existing, status: 'terminated' },
          },
        };

        await handle.write({ storeId: STORE_ID, key: 'root', payload: next });
      });
    },
    {
      invariants: terminateInvariants,
      cacheScope: 'store',
    },
  );
