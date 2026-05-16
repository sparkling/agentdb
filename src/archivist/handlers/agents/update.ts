// charter: dispatch
// agent_update mutation handler (ADR-0180 Phase 5 §Migration concerns).
// Registers as `GuardedWrite<AgentUpdatePayload>` so every patch to an agent
// record transitions through the archivist's audit-chain (intent → applied |
// rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agent-tools.ts`
// `agent_update` handler — accepts a sparse patch (status, health, taskCount,
// config-merge) and persists via `saveAgentStore`. The cli callsite stays in
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
import type { AgentRecord, AgentStore } from './spawn.js';
import { updateInvariants } from '../../invariants/agents/update.js';

/**
 * Mutation payload mirroring the CLI tool's `agent_update` input shape
 * (agent-tools.ts:632-640). All fields besides `agentId` are optional;
 * `config` is shallow-merged into the existing config (matches the cli's
 * `{ ...agent.config, ...input.config }` semantics).
 */
export interface AgentUpdatePayload {
  readonly agentId: string;
  readonly status?: AgentRecord['status'];
  readonly health?: number;
  readonly taskCount?: number;
  readonly config?: Record<string, unknown>;
}

const STORE_ID = 'agent_spawn' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of agent-tools.ts
// `agent_update` callsite once the dispatch boundary is wired through cli.
// Body: read store → if agents[agentId] exists, apply sparse patch (status,
// health, taskCount) + shallow-merge config → write store back. Missing-agent
// surfaces as a failed audit entry rather than a silent no-op (per
// `feedback-no-fallbacks`).
export const updateAgentHandler: GuardedWrite<AgentUpdatePayload> =
  registerMutationHandler<AgentUpdatePayload>(
    'agent_update',
    async (ctx: MutationContext<false>, payload: AgentUpdatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<AgentStore>({
          storeId: STORE_ID,
          key: 'root',
        });
        if (!current || !current.agents[payload.agentId]) {
          throw new Error(`agent_update: agent '${payload.agentId}' not found`);
        }

        const existing = current.agents[payload.agentId];
        const patched: AgentRecord = {
          ...existing,
          ...(payload.status !== undefined ? { status: payload.status } : {}),
          ...(typeof payload.health === 'number' ? { health: payload.health } : {}),
          ...(typeof payload.taskCount === 'number' ? { taskCount: payload.taskCount } : {}),
          ...(payload.config !== undefined
            ? { config: { ...existing.config, ...payload.config } }
            : {}),
        };

        const next: AgentStore = {
          ...current,
          agents: { ...current.agents, [payload.agentId]: patched },
        };

        await handle.write({ storeId: STORE_ID, key: 'root', payload: next });
      });
    },
    {
      invariants: updateInvariants,
      cacheScope: 'store',
    },
  );
