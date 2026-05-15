// charter: dispatch
// wasm_agent_terminate mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers as `GuardedWrite<WasmAgentTerminatePayload>` so every WASM agent
// termination transitions through the archivist's audit-chain (intent →
// applied | rejected) with guard verdicts + invariant verdicts recorded.
// Termination is the most destructive WASM agent transition — the persisted
// record is removed and the live in-memory handle is freed — so the audit
// trail is the load-bearing safety net per
// `feedback-data-loss-zero-tolerance`.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/wasm-agent-tools.ts`
// `wasm_agent_terminate` handler — best-effort calls `terminateWasmAgent` to
// free the live in-memory handle in the current process (may not exist if
// the agent was created by another process and never rehydrated here), then
// authoritatively deletes the persisted record under `withStoreLock`. The
// cli callsite stays in place until the dispatch boundary is wired through
// cli (mirroring memory_store, hive-mind_spawn pending wire-up). This file
// establishes the registration shape the dispatch path will resolve.
//
// Best-effort wrappers must re-throw fatals per
// `feedback-best-effort-must-rethrow-fatals.md` — the cli surface today
// catches all errors around the in-memory free (since the handle may not
// exist in this process) but still propagates I/O failures from the store
// delete. The migrated wire-up preserves that discrimination: live-handle
// absence is non-fatal; store-delete failure is fatal.
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
  type WasmStore,
} from './shared.js';

/**
 * Mutation payload for `wasm_agent_terminate`. The cli's best-effort
 * `terminateWasmAgent(agentId)` (freeing the process-local wasm-bindgen handle,
 * non-fatal if the handle was never rehydrated in this process) stays at the
 * cli surface. The handler owns only the authoritative delete of the persisted
 * record.
 */
export interface WasmAgentTerminatePayload {
  readonly agentId: string;
}

// Ports the persisted-delete half of wasm-agent-tools.ts
// `wasm_agent_terminate` (the `withStoreLock(() => { loadStore → if present:
// delete → saveStore; return present })` block). The cli's `withStoreLock`
// collapses to a single `ctx.substrate.withWrite`. Unlike prompt/tool, a
// missing record here is NOT a fault: the cli explicitly treats `!present`
// as non-fatal (`hadRecord = false`, no throw) — terminating an
// already-absent agent is idempotent success, not an error. Only an actual
// substrate I/O failure (surfaced by `read`/`write` themselves) is fatal.
export const terminateWasmAgentHandler: GuardedWrite<WasmAgentTerminatePayload> =
  registerMutationHandler<WasmAgentTerminatePayload>(
    'wasm_agent_terminate',
    async (ctx: MutationContext<false>, payload: WasmAgentTerminatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: WASM_STORE_ID }, async (handle) => {
        const current = await handle.read<WasmStore>({
          storeId: WASM_STORE_ID,
          key: WASM_STORE_KEY,
        });
        if (!current || !current.agents[payload.agentId]) {
          // Idempotent: nothing persisted under this id — no write needed.
          return;
        }

        const nextAgents = { ...current.agents };
        delete nextAgents[payload.agentId];
        const next: WasmStore = { ...current, agents: nextAgents };

        await handle.write({ storeId: WASM_STORE_ID, key: WASM_STORE_KEY, payload: next });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
