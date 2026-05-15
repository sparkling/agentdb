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
  type StoreId,
} from '../../index.js';

/**
 * Mutation payload mirroring the CLI tool's `wasm_agent_terminate` input
 * shape (wasm-agent-tools.ts:373-378). `agentId` is required by the cli
 * inputSchema; the mutation handler preserves that contract at the wire-up
 * callsite.
 */
export interface WasmAgentTerminatePayload {
  readonly agentId: string;
}

const STORE_ID = 'wasm_agent_terminate' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of wasm-agent-tools.ts
// `wasm_agent_terminate` callsite (best-effort `terminateWasmAgent(agentId)`
// for the live in-memory handle, treating handle-absence as non-fatal →
// delete the persisted record from the FS-JSON store keyed by agent id,
// treating I/O failure as fatal) once the dispatch boundary is wired through
// cli. The cli's outer `withStoreLock` collapses to a single
// `ctx.substrate.withWrite` here because the substrate primitive owns the
// lock semantics; the live `terminateWasmAgent` side-effect runs inside the
// withWrite scope so the audit chain reflects both the live-handle free and
// the persisted delete as one atomic transition.
export const terminateWasmAgentHandler: GuardedWrite<WasmAgentTerminatePayload> =
  registerMutationHandler<WasmAgentTerminatePayload>(
    'wasm_agent_terminate',
    async (ctx: MutationContext<false>, _payload: WasmAgentTerminatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: wasm_agent_terminate handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/wasm-agent-tools.ts wasm_agent_terminate handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
