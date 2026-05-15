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
} from '../../index.js';
import {
  HIVE_DEFAULT_TTL_MS_BY_TYPE,
  HIVE_MEMORY_TYPES,
  type HiveMemoryType,
  type HiveStateDoc,
  isHiveEntryExpired,
  isHiveMemoryType,
} from './hive-state.js';

/** Memory type — mirrors the cli's MemoryType union (ADR-0122 T4: 8 typed
 *  memory types from USERGUIDE). Required on `set`; optional filter on `list`. */
export type HiveMindMemoryType = HiveMemoryType;

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

// Ported from cli/src/mcp-tools/hive-mind-tools.ts `hive-mind_memory` handler
// (lines 2973-3110). The cli's `loadHiveState → mutate sharedMemory[key] →
// saveHiveState under withHiveStoreLock` collapses to a single
// `ctx.substrate.withWrite` per action — the substrate primitive owns the
// lock semantics. Per ADR-0122 (T4) ALL four actions run inside the write
// scope because `get`/`list` lazily evict expired entries (a read-side
// mutation), so they share the audit chain with explicit `set`/`delete`
// writes rather than splitting into a separate read path. `set` validates
// `type`/`ttlMs` BEFORE the read (fail-loud per `feedback-no-fallbacks` —
// no partial write on a bad payload). The mutation surface is `void`;
// the read shaping for `get`/`list` lands when the dispatch boundary wires
// the read-path return shape (ADR-0180 §Read-path return shape) — until
// then both actions still perform their lazy-evict mutation here.
export const memoryHiveMindHandler: GuardedWrite<HiveMindMemoryPayload> =
  registerMutationHandler<HiveMindMemoryPayload>(
    'hive-mind_memory',
    async (ctx: MutationContext<false>, payload: HiveMindMemoryPayload): Promise<void> => {
      if (!payload.key) {
        throw new Error(`hive-mind_memory: \`key\` is required for action '${payload.action}'`);
      }

      // ADR-0122 (T4): `set` validates BEFORE acquiring the write scope so a
      // malformed payload throws without a partial write. `type` is required;
      // a missing/unknown type would mis-route into permanent retention.
      let resolvedTtlMs: number | null = null;
      if (payload.action === 'set') {
        if (payload.type === undefined) {
          throw new Error(
            `hive-mind_memory.set: \`type\` is required (one of: ${HIVE_MEMORY_TYPES.join(', ')})`,
          );
        }
        if (!isHiveMemoryType(payload.type)) {
          throw new Error(
            `hive-mind_memory.set: invalid type ${JSON.stringify(payload.type)} ` +
              `(one of: ${HIVE_MEMORY_TYPES.join(', ')})`,
          );
        }
        const rawTtlMs = payload.ttlMs;
        if (rawTtlMs !== undefined && rawTtlMs !== null) {
          if (typeof rawTtlMs !== 'number' || !Number.isFinite(rawTtlMs)) {
            throw new Error(
              `hive-mind_memory.set: ttlMs must be a finite number, got ${JSON.stringify(rawTtlMs)}`,
            );
          }
        }
        resolvedTtlMs =
          rawTtlMs === undefined || rawTtlMs === null
            ? HIVE_DEFAULT_TTL_MS_BY_TYPE[payload.type]
            : rawTtlMs;
      }

      // ADR-0122 (T4): `list` validates the optional filter type before the
      // write scope — same fail-loud discipline as `set`.
      if (
        payload.action === 'list' &&
        payload.type !== undefined &&
        !isHiveMemoryType(payload.type)
      ) {
        throw new Error(
          `hive-mind_memory.list: invalid type ${JSON.stringify(payload.type)} ` +
            `(one of: ${HIVE_MEMORY_TYPES.join(', ')})`,
        );
      }

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const state = await handle.read<HiveStateDoc>({ storeId: STORE_ID, key: 'root' });
        if (!state) {
          throw new Error('hive-mind_memory: hive-mind not initialized');
        }
        const now = Date.now();
        let mutated = false;

        switch (payload.action) {
          case 'set': {
            const prior = state.sharedMemory[payload.key];
            state.sharedMemory[payload.key] = {
              value: payload.value,
              type: payload.type,
              ttlMs: resolvedTtlMs,
              expiresAt: resolvedTtlMs === null ? null : now + resolvedTtlMs,
              createdAt: prior ? prior.createdAt : now,
              updatedAt: now,
            };
            mutated = true;
            break;
          }
          case 'delete': {
            if (payload.key in state.sharedMemory) {
              delete state.sharedMemory[payload.key];
              mutated = true;
            }
            break;
          }
          case 'get': {
            // Lazy eviction (ADR-0122 T4): drop an expired entry so callers
            // never observe expired data.
            const entry = state.sharedMemory[payload.key];
            if (entry !== undefined && isHiveEntryExpired(entry, now)) {
              delete state.sharedMemory[payload.key];
              mutated = true;
            }
            break;
          }
          case 'list': {
            // Lazy eviction sweep across all entries (ADR-0122 T4).
            for (const [k, entry] of Object.entries(state.sharedMemory)) {
              if (isHiveEntryExpired(entry, now)) {
                delete state.sharedMemory[k];
                mutated = true;
              }
            }
            break;
          }
        }

        // Only rewrite the document when state actually changed — a `get`/
        // `list` with no expired entries is a no-op write we skip.
        if (mutated) {
          await handle.write({ storeId: STORE_ID, key: 'root', payload: state });
        }
      });
    },
    {
      invariants: [], // get/list are conditionally-mutating; set/delete have no cross-call invariant
      cacheScope: 'store',
    },
  );
