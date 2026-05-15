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
  type StoreId,
} from '../../index.js';

/**
 * Mutation payload mirroring the CLI tool's `wasm_agent_tool` input shape
 * (wasm-agent-tools.ts:318-327). `agentId` and `toolName` are required;
 * `toolInput` is optional (e.g. `list_files` takes no params). The wire-up
 * callsite flattens this into the wasm-side `{tool, ...toolInput}` shape.
 */
export interface WasmAgentToolPayload {
  readonly agentId: string;
  readonly toolName: string;
  readonly toolInput?: Record<string, unknown>;
}

const STORE_ID = 'wasm_agent_tool' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of wasm-agent-tools.ts
// `wasm_agent_tool` callsite (`ensureLive(agentId)` to rehydrate → flatten
// `{tool: toolName, ...toolInput}` → `executeWasmTool(agentId, toolCall)` →
// `snapshotAgent` against the live registry → overwrite the persisted record
// under the same agent id) once the dispatch boundary is wired through cli.
// The cli's outer `withStoreLock` collapses to a single
// `ctx.substrate.withWrite` here because the substrate primitive owns the
// lock semantics; the live wasm `executeWasmTool` side-effect runs inside
// the withWrite scope so the snapshot captures post-execution sandbox state
// atomically with the audit chain.
export const wasmAgentToolHandler: GuardedWrite<WasmAgentToolPayload> =
  registerMutationHandler<WasmAgentToolPayload>(
    'wasm_agent_tool',
    async (ctx: MutationContext<false>, _payload: WasmAgentToolPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: wasm_agent_tool handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/wasm-agent-tools.ts wasm_agent_tool handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
