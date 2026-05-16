// charter: dispatch
// agent_spawn mutation handler (ADR-0180 Phase 5 §Migration concerns).
// Registers as `GuardedWrite<AgentSpawnPayload>` so every agent registration
// transitions through the archivist's audit-chain (intent → applied | rejected)
// with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agent-tools.ts`
// `agent_spawn` handler — invokes `loadAgentStore` / `saveAgentStore` against
// `.claude-flow/agents/store.json` (separate file from hive-mind's agents.json
// at `.claude-flow/agents.json`, despite the name parity). The two stores
// share the FS-JSON file family per ADR-0180 §10 "~18 stores per primitive";
// routing both through `makeFsJsonSubstrate` is the contention-gate test that
// Phase 4 §Migration concerns calls out. The cli callsite stays in place
// until the dispatch boundary is wired through cli (mirroring memory_store,
// hive-mind_spawn pending wire-up). This file establishes the registration
// shape the dispatch path will resolve.
//
// ADR-026 3-tier model routing — model determination is computed in the cli
// wrapper today (explicit config → enhanced-model-router → AGENT_TYPE_MODEL_DEFAULTS
// → sonnet fallback). Post wire-up the routing call stays in cli (it's a
// pure compute step, not substrate state); only the persistence path
// dispatches through this handler.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `agents/store.json` mutations may run. Direct `fs.writeFileSync` on the file
// from store-tree code is forbidden by the `no-restricted-imports` backstop
// and the path-restricted substrate-internal.ts seam (ADR-0180 §Type enforcement).

import { registerMutationHandler } from '../../registration.js';
import type {
  GuardedWrite,
  MutationContext,
  StoreId,
} from '../../index.js';
import { spawnInvariants } from '../../invariants/agents/spawn.js';

/** Claude Agent SDK model selector — mirrors the CLI inputSchema enum. */
export type ClaudeModel = 'haiku' | 'sonnet' | 'opus' | 'inherit';

/** How the model was determined — ADR-026 3-tier routing tag. */
export type ModelRoutedBy = 'explicit' | 'router' | 'agent-booster' | 'default';

/** Agent record persisted under `.claude-flow/agents/store.json`. Matches the
 *  AgentRecord interface at cli/src/mcp-tools/agent-tools.ts:22-34. */
export interface AgentRecord {
  readonly agentId: string;
  readonly agentType: string;
  readonly status: 'idle' | 'busy' | 'terminated';
  readonly health: number;
  readonly taskCount: number;
  readonly config: Record<string, unknown>;
  readonly createdAt: string;
  readonly domain?: string;
  readonly model?: ClaudeModel;
  readonly modelRoutedBy?: ModelRoutedBy;
  readonly lastResult?: Record<string, unknown>;
}

/** Top-level shape of `agents/store.json`. */
export interface AgentStore {
  readonly agents: Record<string, AgentRecord>;
  readonly version: string;
}

/**
 * Mutation payload mirroring the CLI tool's `agent_spawn` input shape
 * (agent-tools.ts:185-200). Routing fields (`task`, top-level `model`) are
 * resolved in cli pre-dispatch; the substrate-bound record carries the
 * resolved `model` + `modelRoutedBy` plus the rest of the AgentRecord.
 */
export interface AgentSpawnPayload {
  readonly agent: AgentRecord;
}

const STORE_ID = 'agent_spawn' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of agent-tools.ts
// `agent_spawn` callsite once the dispatch boundary is wired through cli.
// The cli's `loadAgentStore` → mutate → `saveAgentStore` sequence collapses
// to a single `ctx.substrate.withWrite` here because the substrate primitive
// owns the lock semantics. Production wire-up instantiates the FS-JSON store
// via `makeFsJsonSubstrate({ path: '.claude-flow/agents/store.json', ... })`.
// Body: read store → assign payload.agent to store.agents[agent.agentId] →
// write store back.
export const spawnAgentHandler: GuardedWrite<AgentSpawnPayload> =
  registerMutationHandler<AgentSpawnPayload>(
    'agent_spawn',
    async (ctx: MutationContext<false>, payload: AgentSpawnPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<AgentStore>({
          storeId: STORE_ID,
          key: 'root',
        });
        const store: AgentStore = current ?? { agents: {}, version: '3.0.0' };

        const next: AgentStore = {
          ...store,
          agents: { ...store.agents, [payload.agent.agentId]: payload.agent },
        };

        await handle.write({ storeId: STORE_ID, key: 'root', payload: next });
      });
    },
    {
      invariants: spawnInvariants,
      cacheScope: 'store',
    },
  );
