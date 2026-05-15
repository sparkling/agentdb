// charter: dispatch
// wasm_gallery_create mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers as `GuardedWrite<WasmGalleryCreatePayload>` so every gallery-driven
// WASM agent creation transitions through the archivist's audit-chain (intent
// → applied | rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/wasm-agent-tools.ts`
// `wasm_gallery_create` handler — instantiates a `WasmAgent` from a gallery
// template via `createAgentFromTemplate(template)` (which wraps
// `createWasmAgent` with template-supplied instructions), then snapshots
// config + initial state under an O_EXCL advisory lock into
// `.claude-flow/wasm-agents/store.json` so the gallery-created agent
// participates in the same cross-process lifecycle as direct-config agents.
// The cli callsite stays in place until the dispatch boundary is wired
// through cli (mirroring memory_store, hive-mind_spawn pending wire-up).
// This file establishes the registration shape the dispatch path will
// resolve.
//
// Note: `wasm_agent_create` ALSO accepts a `template` arg and follows the
// same gallery path internally — the two registrations exist because the
// cli's MCP tool surface exposes both names (the gallery variant is a
// distinct discoverable tool for clients searching for "gallery"). Both
// route through `createAgentFromTemplate` and snapshot identically; the
// audit chain records which entry-point name the caller used.
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
  loadWasmStore,
  type PersistedWasmAgent,
  type WasmStore,
} from './shared.js';

/**
 * Mutation payload for `wasm_gallery_create`. The cli calls
 * `createAgentFromTemplate(template)` then `snapshotAgent` against the live
 * wasm registry — those live side-effects stay at the cli surface. The handler
 * owns only the persistence transition, so the payload carries the
 * already-snapshotted `PersistedWasmAgent` record (same shape as
 * `wasm_agent_create`'s payload — both persist identically; the audit chain
 * records which cli tool name the caller used).
 */
export interface WasmGalleryCreatePayload {
  readonly agent: PersistedWasmAgent;
}

// Ports the persistence half of wasm-agent-tools.ts `wasm_gallery_create`
// (the `withStoreLock(() => { loadStore → store.agents[id] = snapshot →
// saveStore })` block — byte-identical to `wasm_agent_create`'s persist
// block). The cli's `withStoreLock` collapses to a single
// `ctx.substrate.withWrite` because `makeFsJsonSubstrate` owns the lock
// semantics. The live `createAgentFromTemplate` + `snapshotAgent` calls stay
// in cli and produce `payload.agent`.
export const createWasmGalleryHandler: GuardedWrite<WasmGalleryCreatePayload> =
  registerMutationHandler<WasmGalleryCreatePayload>(
    'wasm_gallery_create',
    async (ctx: MutationContext<false>, payload: WasmGalleryCreatePayload): Promise<void> => {
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
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
