// charter: dispatch
// Shared store shapes + storeIds for the archivist ruvllm_* mutation handlers
// (ADR-0180 Phase 5).
//
// The cli surface (`cli/src/mcp-tools/ruvllm-store.ts`) persists router / SONA /
// MicroLoRA state into THREE FS-JSON files — `.claude-flow/ruvllm/{hnsw,sona,
// microlora}-store.json` — each a config-snapshot + operation-journal document.
// A create-then-operate lifecycle (create in one `cli mcp exec`, add/adapt in the
// next) survives across one-shot process boundaries only because both ops land
// in the SAME file.
//
// The archivist substrate routes per `StoreId`, so the create handler and its
// paired operate handler MUST share one `StoreId` to land in one file — hence
// the three shared ids below (one per WASM type), not six per-handler ids. The
// path overrides that pin these ids to the cli's `ruvllm/{…}-store.json` layout
// live in `substrate-registry.ts` `FS_JSON_PATH_OVERRIDES`.
//
// Document shapes mirror `ruvllm-store.ts` exactly so consumers of the FS-JSON
// files see no contract change once the dispatch path takes over from the cli.

import type { StoreId } from '../../index.js';

// ── Shared storeIds (one per WASM type — create + operate co-reside) ─────────

/** `.claude-flow/ruvllm/hnsw-store.json` — `ruvllm_hnsw_create` + `_hnsw_add`. */
export const RUVLLM_HNSW_STORE_ID = 'ruvllm_hnsw' as StoreId;
/** `.claude-flow/ruvllm/sona-store.json` — `ruvllm_sona_create` + `_sona_adapt`. */
export const RUVLLM_SONA_STORE_ID = 'ruvllm_sona' as StoreId;
/** `.claude-flow/ruvllm/microlora-store.json` — `ruvllm_microlora_create` + `_microlora_adapt`. */
export const RUVLLM_MICROLORA_STORE_ID = 'ruvllm_microlora' as StoreId;

// ── HNSW document (mirrors ruvllm-store.ts `HnswStore`) ─────────────────────

export interface RuvllmHnswPersistedConfig {
  readonly dimensions: number;
  readonly maxPatterns: number;
  readonly efSearch?: number;
}

export interface RuvllmHnswJournalAdd {
  readonly op: 'add';
  readonly name: string;
  readonly embedding: ReadonlyArray<number>;
  readonly metadata?: Record<string, unknown>;
}

export interface RuvllmHnswPersistedRouter {
  id: string;
  createdAt: string;
  config: RuvllmHnswPersistedConfig;
  journal: RuvllmHnswJournalAdd[];
}

export interface RuvllmHnswStore {
  version: string;
  routers: Record<string, RuvllmHnswPersistedRouter>;
}

// ── SONA document (mirrors ruvllm-store.ts `SonaStore`) ─────────────────────

export interface RuvllmSonaPersistedConfig {
  readonly hiddenDim?: number;
  readonly learningRate?: number;
  readonly emaDecay?: number;
  readonly ewcLambda?: number;
  readonly microLoraRank?: number;
  readonly patternCapacity?: number;
}

export type RuvllmSonaJournalEntry =
  | { readonly op: 'adapt'; readonly quality: number }
  | { readonly op: 'recordPattern'; readonly embedding: ReadonlyArray<number>; readonly success: boolean };

export interface RuvllmSonaPersistedInstance {
  id: string;
  createdAt: string;
  config: RuvllmSonaPersistedConfig;
  journal: RuvllmSonaJournalEntry[];
}

export interface RuvllmSonaStore {
  version: string;
  instances: Record<string, RuvllmSonaPersistedInstance>;
}

// ── MicroLoRA document (mirrors ruvllm-store.ts `MicroLoraStore`) ───────────

export interface RuvllmMicroLoraPersistedConfig {
  readonly inputDim: number;
  readonly outputDim: number;
  readonly rank?: number;
  readonly alpha?: number;
}

export interface RuvllmMicroLoraJournalEntry {
  readonly op: 'adapt';
  /**
   * ADR-0231 Wave 2: per-call input vector recorded on every adapt entry.
   * Optional on the journal type for backwards-compat with legacy entries
   * written before Wave 2 (those entries predate the per-call input
   * requirement and were mathematically no-ops — the pre-fork zero-input
   * bug). Replay code paths in cli MUST skip-and-log entries without `input`
   * (ADR-0231 gap #1). New writes go through the dispatch handler, which
   * requires `input` via the payload type + invariants.
   */
  readonly input?: ReadonlyArray<number>;
  readonly quality: number;
  readonly learningRate?: number;
  readonly success?: boolean;
  /** ADR-0231 Wave 2: opt-in EWC++ consolidation pass after the adapt step. */
  readonly consolidate?: boolean;
}

export interface RuvllmMicroLoraPersistedInstance {
  id: string;
  createdAt: string;
  config: RuvllmMicroLoraPersistedConfig;
  journal: RuvllmMicroLoraJournalEntry[];
}

export interface RuvllmMicroLoraStore {
  version: string;
  instances: Record<string, RuvllmMicroLoraPersistedInstance>;
}
