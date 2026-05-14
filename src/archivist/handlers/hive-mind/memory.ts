// charter: dispatch
// hive-mind_memory mutation handler (ADR-0180 Phase 4, §Architecture · Audit chain).
// Registers as `GuardedWrite<HiveMindMemoryPayload>` because two of its four
// actions mutate state (`set`, `delete`) and the remaining two (`get`, `list`)
// perform lazy eviction of expired entries (ADR-0122 T4) — i.e., every action
// is potentially-mutating, so every dispatch transitions through the audit
// chain (intent → applied | rejected) with guard verdicts + invariant verdicts.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/hive-mind-tools.ts`
// `hive-mind_memory` handler — internal switch on `action` invoking
// `loadHiveState` → mutate `state.sharedMemory[key]` → `saveHiveState` under
// `withHiveStoreLock` (ADR-0129 B1) for serialization across concurrent
// writers (e.g., parallel Task workers per ADR-0104 §6). The cli callsite
// stays in place until the dispatch boundary is wired through cli (mirroring
// memory_store, hive-mind_agents, hive-mind_broadcast pending wire-up). This
// file establishes the registration shape the dispatch path will resolve.
//
// Internal action dispatch: `set`/`delete` wrap in `ctx.substrate.withWrite`
// for atomic load → mutate → save; `get`/`list` read via `ctx.substrate.read`
// and only escalate to `withWrite` when lazy eviction detects expired entries
// (per ADR-0122 T4 the lazy-evict path is on the read side but mutates state).
//
// Per ADR-0180 §Provenance rollout scope (Phase 4): `hive-mind_memory` (read
// mode) supports the `includeProvenance?: boolean` parameter — the legacy
// `{action, key, value, exists, ...}` shape stays the default; setting the
// flag returns the full `RankedResult` shape per ADR-0180 §Read-path return
// shape. Provenance carries `storeId: 'hive-mind_memory'`, `matchType: 'exact'`
// (single-key lookup, not similarity rank), `rawScore: 0`, `rank: 1`.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// hive shared-memory state may mutate. Direct fs writes are forbidden by the
// `no-restricted-imports` backstop and the path-restricted
// substrate-internal.ts seam (ADR-0180 §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/** Memory type — mirrors the cli's MemoryType union (ADR-0122 T4: 8 typed
 *  memory types from USERGUIDE). Required on `set`; optional filter on `list`. */
export type HiveMindMemoryType =
  | 'knowledge'
  | 'context'
  | 'task'
  | 'result'
  | 'error'
  | 'metric'
  | 'consensus'
  | 'system';

/** Mutation payload — discriminated by `action`. Mirrors the four cli
 *  call patterns at hive-mind-tools.ts lines 2956-3082. The optional
 *  `includeProvenance` flag is per ADR-0180 §Provenance rollout scope
 *  Phase 4: it only affects the read-mode actions (`get`, `list`); on
 *  write actions it is ignored (dispatch is void on mutation success). */
export type HiveMindMemoryPayload =
  | { readonly action: 'get'; readonly key: string; readonly includeProvenance?: boolean }
  | {
      readonly action: 'set';
      readonly key: string;
      readonly value: unknown;
      readonly type: HiveMindMemoryType;
      readonly ttlMs?: number | null;
    }
  | { readonly action: 'delete'; readonly key: string }
  | {
      readonly action: 'list';
      readonly type?: HiveMindMemoryType;
      readonly includeProvenance?: boolean;
    };

const STORE_ID = 'hive-mind_memory' as StoreId;

// TODO(ADR-0180 Phase 4 wire-up): port the body of hive-mind-tools.ts
// `hive-mind_memory` handler once the dispatch boundary is wired through
// cli. The wrapper-in-cli pattern (loadHiveState → mutate sharedMemory[key]
// → saveHiveState under `withHiveStoreLock`) collapses to a single
// `ctx.substrate.withWrite` per action because the primitive owns the lock
// semantics. Read actions (`get`, `list`) use `ctx.substrate.read` and only
// promote to `withWrite` when lazy eviction (ADR-0122 T4) detects expired
// entries. The cli's outer call to `withHiveStoreLock` becomes redundant
// and is removed in the same commit that flips the dispatch wire-up.
export const memoryHiveMindHandler: GuardedWrite<HiveMindMemoryPayload> =
  registerMutationHandler<HiveMindMemoryPayload>(
    'hive-mind_memory',
    async (ctx: MutationContext<false>, payload: HiveMindMemoryPayload): Promise<void> => {
      switch (payload.action) {
        case 'set':
        case 'delete':
          await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
            throw new Error(
              `archivist: hive-mind_memory (action=${payload.action}) handler body pending Phase 4 wire-up; ` +
              `callers currently route through cli/src/mcp-tools/hive-mind-tools.ts hive-mind_memory handler`,
            );
          });
          return;
        case 'get':
        case 'list':
          // Read-mode actions are dispatched through the mutation surface so
          // that the lazy-eviction path (ADR-0122 T4) shares the audit chain
          // with explicit writes. Pre-wire-up the body is identical to writes
          // — the dispatch boundary lands real read semantics in the wire-up
          // commit (substrate.read / readonly substrate access, with promotion
          // to withWrite only when an expired entry is detected).
          throw new Error(
            `archivist: hive-mind_memory (action=${payload.action}) handler body pending Phase 4 wire-up; ` +
            `callers currently route through cli/src/mcp-tools/hive-mind-tools.ts hive-mind_memory handler`,
          );
      }
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
