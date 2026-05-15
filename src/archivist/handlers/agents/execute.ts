// charter: dispatch
// agent_execute mutation handler (ADR-0180 Phase 5 §Migration concerns).
// Registers as `GuardedWrite<AgentExecutePayload>` so every post-execution
// record patch transitions through the archivist's audit-chain (intent →
// applied | rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agent-tools.ts`
// `agent_execute` handler — calls the Anthropic Messages API through
// `executeAgentTask` (shared with workflow runtime), then writes back
// `lastResult`, increments `taskCount`, and flips `status` between
// 'idle' | 'busy' | 'terminated'. The substrate-bound surface is the
// post-LLM persistence step ONLY: the HTTP call itself is a side-effect
// computed in the cli wrapper (not substrate state). ADR-095 G1 wired the
// real provider call; this handler closes the audit trail on the resulting
// record update.
//
// The cli callsite stays in place until the dispatch boundary is wired
// through cli (mirroring agent_spawn pending wire-up). This file establishes
// the registration shape the dispatch path will resolve.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `agents/store.json` mutations may run. Direct `fs.writeFileSync` on the
// file from store-tree code is forbidden by the `no-restricted-imports`
// backstop and the path-restricted substrate-internal.ts seam (ADR-0180
// §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';
import type { AgentRecord, AgentStore } from './spawn.js';

/**
 * Mutation payload — record-update half of `agent_execute`. The Anthropic
 * Messages API call (agent-tools.ts:303-318 → executeAgentTask) executes in
 * cli; this handler persists the outcome under one audit-traced withWrite.
 *
 * `status` after execution is typically 'idle' on success, may be
 * 'terminated' if the cli explicitly reaped the agent.
 */
export interface AgentExecutePayload {
  readonly agentId: string;
  readonly lastResult: Record<string, unknown>;
  readonly status: AgentRecord['status'];
  readonly taskCountDelta?: number;
}

const STORE_ID = 'agent_spawn' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the persistence half of agent-tools.ts
// `agent_execute` callsite once the dispatch boundary is wired through cli.
// Body: read store → if agents[agentId] exists, set lastResult/status/
// taskCount += delta → write store back. The LLM call (executeAgentTask)
// remains in cli pre-dispatch; this handler is invoked once the result is
// in hand.
export const executeAgentHandler: GuardedWrite<AgentExecutePayload> =
  registerMutationHandler<AgentExecutePayload>(
    'agent_execute',
    async (ctx: MutationContext<false>, payload: AgentExecutePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<AgentStore>({
          storeId: STORE_ID,
          key: 'root',
        });
        if (!current || !current.agents[payload.agentId]) {
          throw new Error(`agent_execute: agent '${payload.agentId}' not found`);
        }

        const existing = current.agents[payload.agentId];
        const delta = payload.taskCountDelta ?? 1;
        const patched: AgentRecord = {
          ...existing,
          status: payload.status,
          taskCount: existing.taskCount + delta,
          lastResult: payload.lastResult,
        };

        const next: AgentStore = {
          ...current,
          agents: { ...current.agents, [payload.agentId]: patched },
        };

        await handle.write({ storeId: STORE_ID, key: 'root', payload: next });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
