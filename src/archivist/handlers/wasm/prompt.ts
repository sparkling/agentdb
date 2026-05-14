// charter: dispatch
// wasm_agent_prompt mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers as `GuardedWrite<WasmAgentPromptPayload>` so every WASM agent
// prompt run transitions through the archivist's audit-chain (intent →
// applied | rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/wasm-agent-tools.ts`
// `wasm_agent_prompt` handler — calls `ensureLive(agentId)` to rehydrate the
// live `WasmAgent` (the wasm-bindgen handle isn't serializable, so each
// process reconstructs it from the persisted config), invokes
// `promptWasmAgent(agentId, input)`, then re-snapshots the agent under
// `withStoreLock` because turnCount + internal state advanced. The cli
// callsite stays in place until the dispatch boundary is wired through cli
// (mirroring memory_store, hive-mind_spawn pending wire-up). This file
// establishes the registration shape the dispatch path will resolve.
//
// This is a mutation despite "prompt" sounding read-only — the agent's
// `turnCount`, conversation state, and any internal scratchpad advance on
// every invocation. The persisted snapshot must reflect post-run state so
// subsequent processes rehydrate the right turn boundary.
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
} from '../../index';

/**
 * Mutation payload mirroring the CLI tool's `wasm_agent_prompt` input shape
 * (wasm-agent-tools.ts:288-297). Both fields are required by the cli
 * inputSchema; the mutation handler preserves that contract at the wire-up
 * callsite.
 */
export interface WasmAgentPromptPayload {
  readonly agentId: string;
  readonly input: string;
}

const STORE_ID = 'wasm_agent_prompt' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of wasm-agent-tools.ts
// `wasm_agent_prompt` callsite (`ensureLive(agentId)` to rehydrate →
// `promptWasmAgent(agentId, input)` → `snapshotAgent` against the live
// registry → overwrite the persisted record under the same agent id) once
// the dispatch boundary is wired through cli. The cli's outer
// `withStoreLock` collapses to a single `ctx.substrate.withWrite` here
// because the substrate primitive owns the lock semantics; the live wasm
// `promptWasmAgent` side-effect runs inside the withWrite scope so the
// snapshot captures post-run state atomically with the audit chain.
export const promptWasmAgentHandler: GuardedWrite<WasmAgentPromptPayload> =
  registerMutationHandler<WasmAgentPromptPayload>(
    'wasm_agent_prompt',
    async (ctx: MutationContext<false>, _payload: WasmAgentPromptPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: wasm_agent_prompt handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/wasm-agent-tools.ts wasm_agent_prompt handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
