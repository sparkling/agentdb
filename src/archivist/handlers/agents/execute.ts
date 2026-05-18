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

import { registerMutationHandler } from '../../registration.js';
import type {
  GuardedWrite,
  MutationContext,
  StoreId,
} from '../../index.js';
import type { AgentRecord, AgentStore } from './spawn.js';
import { executeInvariants } from '../../invariants/agents/execute.js';

/**
 * Mutation payload — record-update half of `agent_execute`. The Anthropic
 * Messages API call (agent-tools.ts:303-318 → executeAgentTask) executes in
 * cli; this handler persists the outcome under audit-traced withWrite scopes.
 *
 * Two distinct dispatches per execution (ADR-0181 Phase C, 2026-05-18):
 *   - Pre-LLM busy reservation:
 *       { agentId, status: 'busy', taskCountDelta: 1 }
 *     `lastResult` omitted — existing field is preserved (caller hasn't
 *     produced a new result yet).
 *   - Post-LLM idle release:
 *       { agentId, status: 'idle', lastResult }
 *     `taskCountDelta` omitted (defaults to 0) — the count already bumped at
 *     reservation time.
 *
 * Two audit entries per execution honour ADR-0180 §Confirmation's
 * "audit-entry count equals mutation count" invariant — pre-LLM reservation
 * and post-LLM release are two distinct mutations.
 *
 * Both fields are optional so partial updates are safe; omit a field to
 * preserve the existing AgentRecord value.
 */
export interface AgentExecutePayload {
  readonly agentId: string;
  readonly status: AgentRecord['status'];
  /** When present, overwrites `agent.lastResult`. Omit on pre-LLM busy
   *  reservation so the prior execution's lastResult is preserved. */
  readonly lastResult?: Record<string, unknown>;
  /** Defaults to 0. Pre-LLM busy reservation passes 1; post-LLM idle release
   *  passes 0 (or omits). Negative deltas reserved for future rollback paths. */
  readonly taskCountDelta?: number;
}

const STORE_ID = 'agent_spawn' as StoreId;

// ADR-0181 Phase C wire-up (2026-05-18): cli's `agent-execute-core.ts` now
// dispatches through this handler. Two dispatches per execution: pre-LLM
// busy reservation + post-LLM idle release. The Anthropic Messages API call
// remains in cli pre-dispatch (between the two dispatches).
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
        const delta = payload.taskCountDelta ?? 0;
        const patched: AgentRecord = {
          ...existing,
          status: payload.status,
          taskCount: existing.taskCount + delta,
          // Preserve existing lastResult when caller omits the field
          // (pre-LLM busy reservation case).
          ...(payload.lastResult !== undefined ? { lastResult: payload.lastResult } : {}),
        };

        const next: AgentStore = {
          ...current,
          agents: { ...current.agents, [payload.agentId]: patched },
        };

        await handle.write({ storeId: STORE_ID, key: 'root', payload: next });
      });
    },
    {
      invariants: executeInvariants,
      cacheScope: 'store',
    },
  );
