// charter: substrate-seam
// hive-mind_agents mutation handler (ADR-0180 Phase 4 §Migration concerns).
// SECOND consumer of `makeFsJsonSubstrate` — validates that the primitive
// extracted from hive-mind's `withHiveStoreLock` (the first consumer:
// hive-state.json) is substrate-GENERIC rather than tailored to a single
// file. agents.json shares the same FS-JSON file family as hive-state.json
// (per ADR-0180 §10 "~18 stores per primitive"), so routing it through the
// same SubstrateAccess.withWrite proves the seam is reusable.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/hive-mind-tools.ts`
// `saveAgentStore` / `loadAgentStore` — wrapped by agents-json-fixer in
// `withHiveStoreLock` so concurrent spawn / init / shutdown writes serialize
// per ADR-0129 (B1). The cli callsites stay in place; the dispatch boundary
// is wired through cli in a later phase (mirroring memory_store's pending
// wire-up). This file establishes the registration shape the dispatch path
// will resolve.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// agents.json mutations may run. Direct `fs.writeFileSync` on the file from
// store-tree code is forbidden by the `no-restricted-imports` backstop and
// the path-restricted substrate-internal.ts seam (ADR-0180 §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/** Single agent record persisted under agents.json. Matches the structure
 *  produced by hive-mind_spawn / agent_spawn at the cli surface. */
export interface AgentRecord {
  readonly agentId: string;
  readonly agentType: string;
  readonly status: 'idle' | 'busy' | 'errored';
  readonly health: number;
  readonly taskCount: number;
  readonly config: Record<string, unknown>;
  readonly createdAt: string;
  readonly domain: string;
}

/** Mutation payload — discriminated by `action`. spawn adds an entry,
 *  remove deletes by id, clear empties the store. Mirrors the three call
 *  patterns at hive-mind-tools.ts (lines 1408-1464 spawn, 2815-2821 clear). */
export type AgentsJsonPayload =
  | { readonly action: 'spawn'; readonly agent: AgentRecord }
  | { readonly action: 'remove'; readonly agentId: string }
  | { readonly action: 'clear'; readonly agentIds: ReadonlyArray<string> };

const STORE_ID = 'hive-mind_agents' as StoreId;

// TODO(ADR-0180 Phase 4 wire-up): port the body of hive-mind-tools.ts
// `saveAgentStore`/`loadAgentStore` callsites once the dispatch boundary is
// wired through cli. The wrapper-in-cli pattern (load → mutate → save under
// `withHiveStoreLock`) collapses to a single `ctx.substrate.withWrite` here
// because the primitive owns the lock semantics. The cli's outer call to
// `withHiveStoreLock` becomes redundant and is removed in the same commit
// that flips the dispatch wire-up.
export const agentsJsonHandler: GuardedWrite<AgentsJsonPayload> =
  registerMutationHandler<AgentsJsonPayload>(
    'hive-mind_agents',
    async (ctx: MutationContext<false>, payload: AgentsJsonPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<{ agents: Record<string, AgentRecord> }>({
          storeId: STORE_ID,
          key: 'root',
        });
        const store = current ?? { agents: {} };

        switch (payload.action) {
          case 'spawn':
            store.agents[payload.agent.agentId] = payload.agent;
            break;
          case 'remove':
            delete store.agents[payload.agentId];
            break;
          case 'clear':
            for (const id of payload.agentIds) {
              delete store.agents[id];
            }
            break;
        }

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
