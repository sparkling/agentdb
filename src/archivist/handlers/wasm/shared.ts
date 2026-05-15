// charter: dispatch
// Shared store shape + default-store factory for the five archivist wasm_*
// mutation handlers (ADR-0180 Phase 5 / ADR-0181 Phase 2).
//
// Mirrors `WasmStore` / `PersistedAgent` from
// cli/src/mcp-tools/wasm-agent-tools.ts. The cli's `loadStore()` returns the
// `loadWasmStore()` default when `.claude-flow/wasm-agents/store.json` is
// absent; the archivist handlers read the substrate first and fall back to
// this same default so an un-initialised store behaves identically to the cli
// path.
//
// STORE_ID convention: all five wasm_* handlers register under distinct cli
// tool names but share ONE `WASM_STORE_ID` — they all back the single
// `wasm-agents/store.json` file, so they must resolve to the same
// `SubstrateAccess` (one file, one lock). This mirrors the agents/* family,
// where the six `agent_*` handlers all use `STORE_ID = 'agent_spawn'`.
//
// The live `WasmAgent` side-effects (`createWasmAgent`, `promptWasmAgent`,
// `executeWasmTool`, `terminateWasmAgent`, `snapshotAgent`) are NOT ported into
// the handler bodies — they stay at the cli surface (the wasm-bindgen handle is
// process-local and non-serialisable). The handler owns only the persistence
// transition, so the mutation payloads carry the already-snapshotted
// `PersistedAgent` record. This mirrors agents/spawn.ts, where ADR-026 model
// routing stays in cli and only the persistence path dispatches.

import type { StoreId } from '../../index.js';

/** Persisted WASM agent record — matches `PersistedAgent` at
 *  cli/src/mcp-tools/wasm-agent-tools.ts:32-53. */
export interface PersistedWasmAgent {
  readonly id: string;
  readonly config: {
    readonly model?: string;
    readonly instructions?: string;
    readonly maxTurns?: number;
  };
  readonly info: {
    readonly id: string;
    readonly state: 'idle' | 'running' | 'error';
    readonly config: { model?: string; instructions?: string; maxTurns?: number };
    readonly model: string;
    readonly turnCount: number;
    readonly fileCount: number;
    readonly isStopped: boolean;
    readonly createdAt: string;
  };
  readonly state?: unknown;
  readonly tools?: ReadonlyArray<string>;
  readonly todos?: ReadonlyArray<unknown>;
  readonly stateSnapshotAt?: string;
}

/** Top-level shape of `wasm-agents/store.json` — matches `WasmStore`. */
export interface WasmStore {
  readonly version: string;
  readonly agents: Record<string, PersistedWasmAgent>;
}

/**
 * Single shared `StoreId` for the wasm_* family. All five handlers
 * (create / gallery-create / prompt / tool / terminate) back the one
 * `wasm-agents/store.json` file, so they resolve to one `SubstrateAccess`.
 */
export const WASM_STORE_ID = 'wasm_agent_create' as StoreId;

/** Key for the single canonical record inside the wasm store. */
export const WASM_STORE_KEY = 'root';

/** Default store — mirrors `loadStore()`'s default branch in the cli. */
export function loadWasmStore(): WasmStore {
  return { version: '1.0.0', agents: {} };
}
