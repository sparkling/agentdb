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
  type StoreId,
} from '../../index';

/**
 * Mutation payload mirroring the CLI tool's `wasm_gallery_create` input
 * shape (wasm-agent-tools.ts:478-486). `template` is required by the cli
 * inputSchema; the mutation handler preserves that contract at the wire-up
 * callsite. Valid template names per the cli description: `coder`,
 * `researcher`, `tester`, `reviewer`, `security`, `swarm`.
 */
export interface WasmGalleryCreatePayload {
  readonly template: string;
}

const STORE_ID = 'wasm_gallery_create' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of wasm-agent-tools.ts
// `wasm_gallery_create` callsite (`createAgentFromTemplate(template)` →
// extract config triple (`model`, `instructions`, `maxTurns`) from the
// returned `info.config` → `snapshotAgent` against the live wasm registry →
// persist the `PersistedAgent` record into the FS-JSON store keyed by agent
// id) once the dispatch boundary is wired through cli. The cli's outer
// `withStoreLock` collapses to a single `ctx.substrate.withWrite` here
// because the substrate primitive owns the lock semantics; the live
// `createAgentFromTemplate` side-effect runs inside the withWrite scope so
// the snapshot captures initial state atomically with the audit chain.
export const createWasmGalleryHandler: GuardedWrite<WasmGalleryCreatePayload> =
  registerMutationHandler<WasmGalleryCreatePayload>(
    'wasm_gallery_create',
    async (ctx: MutationContext<false>, _payload: WasmGalleryCreatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: wasm_gallery_create handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/wasm-agent-tools.ts wasm_gallery_create handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
