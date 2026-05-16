// charter: dispatch
// wasm_agent_create mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers as `GuardedWrite<WasmAgentCreatePayload>` so every WASM agent
// creation transitions through the archivist's audit-chain (intent → applied |
// rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/wasm-agent-tools.ts`
// `wasm_agent_create` handler — instantiates a `WasmAgent` via
// `createWasmAgent(config)` (or `createAgentFromTemplate(template)` for the
// gallery path), then snapshots config + initial state under an O_EXCL
// advisory lock into `.claude-flow/wasm-agents/store.json`. The cli callsite
// stays in place until the dispatch boundary is wired through cli (mirroring
// memory_store, hive-mind_spawn pending wire-up). This file establishes the
// registration shape the dispatch path will resolve.
//
// Two creation paths share one mutation handler:
//   1. `template`-driven (gallery) — wraps `createWasmAgent` with template
//      instructions; only the saved config fields matter for rehydration.
//   2. `model`/`instructions`/`maxTurns`-driven (direct) — passes the config
//      object straight to `createWasmAgent`.
// Both write through the same `withStoreLock` → `snapshotAgent` → `saveStore`
// path today; the migrated wire-up collapses that to a single
// `ctx.substrate.withWrite` because the FS-JSON substrate's O_EXCL sentinel
// lock subsumes the legacy `withStoreLock` (same ADR-0095 advisory-lock
// pattern as rvf-backend, reused at substrate seam).
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// WASM agent persistence state may mutate. Direct fs writes are forbidden by
// the `no-restricted-imports` backstop and the path-restricted
// substrate-internal.ts seam (ADR-0180 §Type enforcement). Production wire-up
// instantiates the FS-JSON store via `makeFsJsonSubstrate` from
// `archivist/substrates`.

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext } from '../../index.js';
import { createInvariants } from '../../invariants/wasm/create.js';
import {
  WASM_STORE_ID,
  WASM_STORE_KEY,
  loadWasmStore,
  type PersistedWasmAgent,
  type WasmStore,
} from './shared.js';

/**
 * Mutation payload for `wasm_agent_create`. The cli branches on `args.template`
 * to call `createAgentFromTemplate` or `createWasmAgent`, then `snapshotAgent`
 * against the live wasm registry — those live wasm-bindgen side-effects stay at
 * the cli surface (the handle is process-local + non-serialisable). The handler
 * owns only the persistence transition, so the payload carries the
 * already-snapshotted `PersistedWasmAgent` record. This mirrors
 * agents/spawn.ts, where ADR-026 model routing stays in cli and only the
 * persisted record dispatches.
 */
export interface WasmAgentCreatePayload {
  readonly agent: PersistedWasmAgent;
}

// Ports the persistence half of wasm-agent-tools.ts `wasm_agent_create`
// (the `withStoreLock(() => { loadStore → store.agents[id] = snapshot →
// saveStore })` block). The cli's `withStoreLock` collapses to a single
// `ctx.substrate.withWrite` because `makeFsJsonSubstrate` owns the lock
// semantics. The live `createWasmAgent` / `createAgentFromTemplate` +
// `snapshotAgent` calls stay in cli and produce `payload.agent`.
export const createWasmAgentHandler: GuardedWrite<WasmAgentCreatePayload> =
  registerMutationHandler<WasmAgentCreatePayload>(
    'wasm_agent_create',
    async (ctx: MutationContext<false>, payload: WasmAgentCreatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: WASM_STORE_ID }, async (handle) => {
        const current = await handle.read<WasmStore>({
          storeId: WASM_STORE_ID,
          key: WASM_STORE_KEY,
        });
        const store: WasmStore = current ?? loadWasmStore();

        const next: WasmStore = {
          ...store,
          agents: { ...store.agents, [payload.agent.id]: payload.agent },
        };

        await handle.write({ storeId: WASM_STORE_ID, key: WASM_STORE_KEY, payload: next });
      });
    },
    {
      invariants: createInvariants,
      cacheScope: 'global',
    },
  );
