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

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext } from '../../index.js';
import {
  WASM_STORE_ID,
  WASM_STORE_KEY,
  type PersistedWasmAgent,
  type WasmStore,
} from './shared.js';

/**
 * Mutation payload for `wasm_agent_prompt`. The cli calls `ensureLive` +
 * `promptWasmAgent(agentId, input)` then `snapshotAgent` — those live wasm
 * side-effects stay at the cli surface. The handler owns only the
 * re-persistence of the post-run snapshot, so the payload carries the
 * already-re-snapshotted `PersistedWasmAgent` record (the `agentId` is
 * `agent.id`).
 */
export interface WasmAgentPromptPayload {
  readonly agent: PersistedWasmAgent;
}

// Ports the re-snapshot half of wasm-agent-tools.ts `wasm_agent_prompt`
// (the `withStoreLock(() => { loadStore → if existing: store.agents[id] =
// snapshot → saveStore })` block). The cli's `withStoreLock` collapses to a
// single `ctx.substrate.withWrite`. The cli's `if (existing)` skip is ported
// as a loud throw: by the time the prompt has run, a missing record means a
// concurrent terminate raced the prompt — that is a real fault, not a
// silently-skipped no-op (`feedback-no-fallbacks`, mirrors agents/terminate.ts).
export const promptWasmAgentHandler: GuardedWrite<WasmAgentPromptPayload> =
  registerMutationHandler<WasmAgentPromptPayload>(
    'wasm_agent_prompt',
    async (ctx: MutationContext<false>, payload: WasmAgentPromptPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: WASM_STORE_ID }, async (handle) => {
        const current = await handle.read<WasmStore>({
          storeId: WASM_STORE_ID,
          key: WASM_STORE_KEY,
        });
        if (!current || !current.agents[payload.agent.id]) {
          throw new Error(
            `wasm_agent_prompt: agent '${payload.agent.id}' not found at persist time ` +
            `(concurrent terminate raced the prompt run)`,
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
