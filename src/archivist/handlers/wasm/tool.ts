// charter: dispatch
// wasm_agent_tool mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers as `GuardedWrite<WasmAgentToolPayload>` so every sandboxed tool
// execution transitions through the archivist's audit-chain (intent →
// applied | rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/wasm-agent-tools.ts`
// `wasm_agent_tool` handler — calls `ensureLive(agentId)` to rehydrate the
// live `WasmAgent`, flattens `{toolName, toolInput}` into the wasm-side
// `{tool, ...toolInput}` shape, invokes `executeWasmTool(agentId, toolCall)`,
// then re-snapshots the agent under `withStoreLock` because fileCount and
// internal sandbox state may have advanced (write_file, edit_file,
// write_todos all mutate the virtual filesystem). The cli callsite stays in
// place until the dispatch boundary is wired through cli (mirroring
// memory_store, hive-mind_spawn pending wire-up). This file establishes the
// registration shape the dispatch path will resolve.
//
// All five tool variants (`read_file`, `write_file`, `edit_file`,
// `write_todos`, `list_files`) compose under one mutation registration
// because the persisted snapshot must reflect post-execution state regardless
// of which tool ran — even `read_file` advances internal access counters in
// some agent variants per the wasm-bindgen contract.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// WASM agent persistence state may mutate. Direct fs writes are forbidden by
// the `no-restricted-imports` backstop and the path-restricted
// substrate-internal.ts seam (ADR-0180 §Type enforcement). Production wire-up
// instantiates the FS-JSON store via `makeFsJsonSubstrate` from
// `archivist/substrates`.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
} from '../../index.js';
import {
  WASM_STORE_ID,
  WASM_STORE_KEY,
  type PersistedWasmAgent,
  type WasmStore,
} from './shared.js';

/**
 * Mutation payload for `wasm_agent_tool`. The cli calls `ensureLive` +
 * `executeWasmTool(agentId, {tool, ...toolInput})` then `snapshotAgent` — those
 * live wasm side-effects (which advance fileCount / virtual-fs state) stay at
 * the cli surface. The handler owns only the re-persistence of the
 * post-execution snapshot, so the payload carries the already-re-snapshotted
 * `PersistedWasmAgent` record.
 */
export interface WasmAgentToolPayload {
  readonly agent: PersistedWasmAgent;
}

// Ports the re-snapshot half of wasm-agent-tools.ts `wasm_agent_tool`
// (the `withStoreLock(() => { loadStore → if existing: store.agents[id] =
// snapshot → saveStore })` block — byte-identical to `wasm_agent_prompt`'s
// persist block). The cli's `withStoreLock` collapses to a single
// `ctx.substrate.withWrite`. The cli's `if (existing)` skip is ported as a
// loud throw: a missing record after the tool ran means a concurrent
// terminate raced the execution (`feedback-no-fallbacks`).
export const wasmAgentToolHandler: GuardedWrite<WasmAgentToolPayload> =
  registerMutationHandler<WasmAgentToolPayload>(
    'wasm_agent_tool',
    async (ctx: MutationContext<false>, payload: WasmAgentToolPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: WASM_STORE_ID }, async (handle) => {
        const current = await handle.read<WasmStore>({
          storeId: WASM_STORE_ID,
          key: WASM_STORE_KEY,
        });
        if (!current || !current.agents[payload.agent.id]) {
          throw new Error(
            `wasm_agent_tool: agent '${payload.agent.id}' not found at persist time ` +
            `(concurrent terminate raced the tool execution)`,
          );
        }

        const next: WasmStore = {
          ...current,
          agents: { ...current.agents, [payload.agent.id]: payload.agent },
        };

        await handle.write({ storeId: WASM_STORE_ID, key: WASM_STORE_KEY, payload: next });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
