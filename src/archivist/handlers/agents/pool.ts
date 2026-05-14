// charter: dispatch
// agent_pool mutation handler (ADR-0180 Phase 5 §Migration concerns).
// Registers as `GuardedWrite<AgentPoolPayload>` so every pool-scaling /
// draining mutation transitions through the archivist's audit-chain (intent →
// applied | rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agent-tools.ts`
// `agent_pool` handler — multi-action: 'status' (read-only),
// 'scale' (mint new idle agents or mark idle agents 'terminated' to hit
// target size), 'drain' (mark all idle agents of an optional agentType
// 'terminated'), 'fill' (declared in the inputSchema enum, not currently
// implemented). The cli registers all four actions under one MCP tool name;
// the read-only 'status' action is intentionally dispatched through the same
// mutation handler in cli — when the wire-up commits, 'status' will route
// through `Archivist.dispatchRead` via a sibling read handler so the audit
// chain only fires for true mutations (per ADR-0180 §Audit chain — reads are
// passthroughs).
//
// The cli callsite stays in place until the dispatch boundary is wired
// through cli (mirroring agent_spawn pending wire-up). This file establishes
// the registration shape the dispatch path will resolve for the mutating
// actions ('scale' | 'drain' | 'fill').
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
} from '../../index';
import type { AgentRecord, AgentStore } from './spawn';

/** Pool actions — mirrors the CLI inputSchema enum (agent-tools.ts:443-447).
 *  'status' is read-only and routes through dispatchRead at wire-up time. */
export type AgentPoolAction = 'status' | 'scale' | 'drain' | 'fill';

/**
 * Mutation payload mirroring the CLI tool's `agent_pool` input shape
 * (agent-tools.ts:443-448). `targetSize` is required for 'scale'; `agentType`
 * filters 'scale' and 'drain'. Defaults applied at the wire-up callsite:
 * `agentType='worker'` for 'scale', undefined (= all types) for 'drain'.
 */
export interface AgentPoolPayload {
  readonly action: AgentPoolAction;
  readonly targetSize?: number;
  readonly agentType?: string;
}

const STORE_ID = 'agent_spawn' as StoreId;

function scalePool(store: AgentStore, agentType: string, targetSize: number): AgentStore {
  const agents = Object.values(store.agents).filter((a) => a.status !== 'terminated');
  const currentSize = agents.filter((a) => a.agentType === agentType).length;
  const delta = targetSize - currentSize;

  const nextAgents: Record<string, AgentRecord> = { ...store.agents };
  if (delta > 0) {
    for (let i = 0; i < delta; i++) {
      const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      nextAgents[agentId] = {
        agentId,
        agentType,
        status: 'idle',
        health: 1.0,
        taskCount: 0,
        config: {},
        createdAt: new Date().toISOString(),
      };
    }
  } else if (delta < 0) {
    const idleOfType = agents.filter(
      (a) => a.agentType === agentType && a.status === 'idle',
    );
    const toRemove = idleOfType.slice(0, -delta);
    for (const agent of toRemove) {
      nextAgents[agent.agentId] = { ...agent, status: 'terminated' };
    }
  }
  return { ...store, agents: nextAgents };
}

function drainPool(store: AgentStore, agentType: string | undefined): AgentStore {
  const nextAgents: Record<string, AgentRecord> = { ...store.agents };
  for (const agent of Object.values(store.agents)) {
    if (agent.status !== 'idle') continue;
    if (agentType && agent.agentType !== agentType) continue;
    nextAgents[agent.agentId] = { ...agent, status: 'terminated' };
  }
  return { ...store, agents: nextAgents };
}

// Body (ADR-0180 Phase 5): read store → apply per-action transform (see
// `scalePool` / `drainPool` helpers above) → write store back, all inside one
// `ctx.substrate.withWrite` so the FS-JSON lock spans the read-modify-write.
// Reads ('status') route through `dispatchRead` via a sibling read handler at
// cli wire-up time; only 'scale' / 'drain' / 'fill' actions reach this handler.
// The cli callsite (agent-tools.ts `agent_pool`) stays authoritative until the
// dispatch boundary is wired through cli (mirrors agent_spawn pending wire-up).
export const poolAgentHandler: GuardedWrite<AgentPoolPayload> =
  registerMutationHandler<AgentPoolPayload>(
    'agent_pool',
    async (ctx: MutationContext<false>, payload: AgentPoolPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<AgentStore>({
          storeId: STORE_ID,
          key: 'root',
        });
        const store: AgentStore = current ?? { agents: {}, version: '3.0.0' };

        let next: AgentStore;
        switch (payload.action) {
          case 'scale': {
            const agentType = payload.agentType ?? 'worker';
            const targetSize = payload.targetSize ?? 5;
            next = scalePool(store, agentType, targetSize);
            break;
          }
          case 'drain': {
            next = drainPool(store, payload.agentType);
            break;
          }
          case 'fill':
            throw new Error(
              `agent_pool: action 'fill' not implemented (declared in CLI inputSchema but no cli body); ` +
              `wire-up pending`,
            );
          case 'status':
            throw new Error(
              `agent_pool: action 'status' is read-only — route through Archivist.dispatchRead`,
            );
          default: {
            const _exhaustive: never = payload.action;
            throw new Error(`agent_pool: unknown action '${String(_exhaustive)}'`);
          }
        }

        await handle.write({ storeId: STORE_ID, key: 'root', payload: next });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
