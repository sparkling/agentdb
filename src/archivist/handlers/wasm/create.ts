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

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/**
 * Mutation payload mirroring the CLI tool's `wasm_agent_create` input shape
 * (wasm-agent-tools.ts:237-245). `template` and the direct-config triple
 * (`model`/`instructions`/`maxTurns`) are accepted side-by-side; the cli
 * callsite branches on `args.template` presence. The mutation handler
 * preserves that branching at the wire-up callsite — payload validation lives
 * in the dispatch path, not the registration shape.
 */
export interface WasmAgentCreatePayload {
  readonly template?: string;
  readonly model?: string;
  readonly instructions?: string;
  readonly maxTurns?: number;
}

const STORE_ID = 'wasm_agent_create' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of wasm-agent-tools.ts
// `wasm_agent_create` callsite (branch on `template` → call
// `createAgentFromTemplate` or `createWasmAgent` with the direct config →
// `snapshotAgent` against the live wasm registry → persist the
// `PersistedAgent` record into the FS-JSON store keyed by agent id) once the
// dispatch boundary is wired through cli. The cli's outer `withStoreLock`
// collapses to a single `ctx.substrate.withWrite` here because the substrate
// primitive owns the lock semantics; the live `createWasmAgent` side-effect
// moves to an out-of-band step after the persist succeeds (rehydration on
// read is already handled by `ensureLive` in the cli surface).
export const createWasmAgentHandler: GuardedWrite<WasmAgentCreatePayload> =
  registerMutationHandler<WasmAgentCreatePayload>(
    'wasm_agent_create',
    async (ctx: MutationContext<false>, _payload: WasmAgentCreatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: wasm_agent_create handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/wasm-agent-tools.ts wasm_agent_create handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
