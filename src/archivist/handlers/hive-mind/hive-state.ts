// charter: dispatch
// Shared hive-state shapes for archivist hive-mind_* handlers (ADR-0180 Phase 2).
// Mirrors `cli/src/mcp-tools/hive-mind-tools.ts` `HiveState` / `MemoryEntry`
// verbatim (the fields the un-stubbed handlers read/write) so the dispatch
// boundary round-trips the same on-disk `.claude-flow/hive-mind/state.json`
// document without a schema migration. The cli's interface declarations stay
// in place until Phase 5+ removes the legacy callsites; until then both
// surfaces share the same JSON document.
//
// The FS-JSON substrate (`makeFsJsonSubstrate`) addresses the document by
// top-level field — the whole `HiveState` lives under `key: 'root'`, matching
// the `agents-json.ts` / `tasks/create.ts` convention.

/** Memory type — mirrors the cli `MemoryType` union (ADR-0122 T4, 8 types). */
export type HiveMemoryType =
  | 'knowledge'
  | 'context'
  | 'task'
  | 'result'
  | 'error'
  | 'metric'
  | 'consensus'
  | 'system';

/** Typed shared-memory entry with TTL — mirrors cli `MemoryEntry`. */
export interface HiveMemoryEntry {
  value: unknown;
  type: HiveMemoryType;
  /** null = permanent. */
  ttlMs: number | null;
  /** null = permanent; epoch ms otherwise. */
  expiresAt: number | null;
  /** epoch ms — set on first write. */
  createdAt: number;
  /** epoch ms — refreshed on every write. */
  updatedAt: number;
}

/** Per-worker failure metadata — mirrors cli `WorkerMeta` (ADR-0131 T12). */
export interface HiveWorkerMeta {
  failedAt: number | null;
  retryOf: string | null;
}

/** Hive-state document — the subset of cli `HiveState` the un-stubbed
 *  handlers (broadcast, memory, shutdown, spawn) read/write. Unrelated
 *  fields (config, queen, consensus, topology) round-trip untouched via
 *  the index signature. */
export interface HiveStateDoc {
  initialized: boolean;
  workers: string[];
  workerMeta?: Record<string, HiveWorkerMeta>;
  consensus: {
    pending: unknown[];
    history: unknown[];
  };
  sharedMemory: Record<string, HiveMemoryEntry>;
  createdAt: string;
  updatedAt: string;
  /** Unrelated cli `HiveState` fields (topology, config, queen, …) round-trip
   *  through the loaded document without re-declaration. */
  [key: string]: unknown;
}

/** Per-type default TTLs — mirrors cli `DEFAULT_TTL_MS_BY_TYPE`, derived from
 *  the USERGUIDE "Collective Memory Types" table. `null` = permanent. */
export const HIVE_DEFAULT_TTL_MS_BY_TYPE: Record<HiveMemoryType, number | null> = {
  knowledge: null,
  context: 3_600_000,
  task: 1_800_000,
  result: null,
  error: 86_400_000,
  metric: 3_600_000,
  consensus: null,
  system: null,
};

/** Fixed memory-type enum — mirrors cli `MEMORY_TYPES`. */
export const HIVE_MEMORY_TYPES: ReadonlyArray<HiveMemoryType> = [
  'knowledge',
  'context',
  'task',
  'result',
  'error',
  'metric',
  'consensus',
  'system',
];

/** Type guard for `HiveMemoryType` — mirrors cli `isMemoryType`. */
export function isHiveMemoryType(v: unknown): v is HiveMemoryType {
  return typeof v === 'string' && (HIVE_MEMORY_TYPES as readonly string[]).includes(v);
}

/** Eviction predicate — mirrors cli `isExpired`. `now` is injectable for tests. */
export function isHiveEntryExpired(entry: HiveMemoryEntry, now: number = Date.now()): boolean {
  return entry.expiresAt !== null && now >= entry.expiresAt;
}
