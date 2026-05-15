// charter: dispatch
// config_set mutation handler (ADR-0180 Phase 5 §Migration concerns).
// FS-JSON migrator: `.claude-flow/config.json` is part of the FS-JSON store
// family enumerated under ADR-0180 §Caller surfaces Recommendation (~18 stores
// per primitive). Routes through the same `makeFsJsonSubstrate` primitive
// already consumed by hive-mind_agents (agents-json.ts), proving the seam
// extracted from `withHiveStoreLock` is substrate-GENERIC across store families.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/config-tools.ts`
// `config_set` handler — `loadConfigStore` → mutate `store.values` or
// `store.scopes[scope]` → `saveConfigStore` (sync `writeFileSync`, NOT under
// an O_EXCL lock today). Migration anchors the file behind
// `ctx.substrate.withWrite` so concurrent `config_set` / `config_reset` /
// `config_import` writes serialize per the same durability stack hive-state
// already enjoys (tmp + fsync + rename + lock). The cli callsite stays in
// place until the dispatch boundary is wired through cli (mirroring
// memory_store, hive-mind_agents pending wire-up). This file establishes the
// registration shape the dispatch path will resolve.
//
// Shape tolerance is preserved: the cli surface detects MCP-flat vs
// init-generated legacy nested trees and persists whichever shape was loaded
// (config-tools.ts:9-18). The substrate is shape-agnostic — it round-trips
// JSON; the handler body (wire-up phase) keeps the same `detectShape` /
// `__shape` carry-through that BUG-A (scoped writes on legacy) and BUG-B
// (DEFAULT_CONFIG flat-into-nested) cover today.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/config.json` may mutate. Direct `writeFileSync` from store-tree
// code is forbidden by the `no-restricted-imports` backstop and the
// path-restricted substrate-internal.ts seam (ADR-0180 §Type enforcement).
// Production wire-up instantiates the FS-JSON store via `makeFsJsonSubstrate`
// from `archivist/substrates`.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';
import {
  type ConfigScope as ConfigScopeType,
  type ConfigStore,
  normalizeConfigStore,
  setNestedValue,
} from './config-store.js';

/** Scope discriminator — mirrors the cli `config_set` inputSchema. `'default'`
 *  writes into `store.values` (top-level); any other string writes into
 *  `store.scopes[scope]`. Legacy-shape files reject scope !== 'default' per
 *  ADR-0094 Phase 8 BUG-A (config-tools.ts:321-332). */
export type ConfigScope = ConfigScopeType;

/** Mutation payload — mirrors the cli `config_set` inputSchema. `value` is
 *  intentionally `unknown` (the cli accepts arbitrary JSON shapes); the cli
 *  surface validates non-empty `key` and non-undefined `value` per ADR-0094
 *  P11/P12 (config-tools.ts:296-308) and that validation moves into the
 *  handler body at wire-up. */
export interface ConfigSetPayload {
  readonly key: string;
  readonly value: unknown;
  readonly scope?: ConfigScope;
}

const STORE_ID = 'config' as StoreId;

// Ported from cli/src/mcp-tools/config-tools.ts `config_set` handler
// (lines 291-368). The cli's bare `loadConfigStore` / `saveConfigStore` pair
// (no lock at the cli surface) collapses to a single `ctx.substrate.withWrite`
// — the substrate primitive supplies the O_EXCL lock the cli surface lacked,
// so concurrent config_set / config_reset / config_import writes now serialize.
//
// Validation branches port verbatim (`feedback-no-fallbacks` — all fail loud):
//   • non-empty `key` / non-undefined `value` (ADR-0094 P11/P12).
//   • BUG-A: a legacy-shape config.json has no scope concept and its persist
//     path only writes `values`, so a scoped write would silently drop on
//     reload — reject it loudly instead.
//   • dot-notation `setNestedValue` for legacy nested trees and scoped dotted
//     keys; MCP-flat direct key writes otherwise; dangerous-key filtering is
//     inside `setNestedValue`.
export const configSetHandler: GuardedWrite<ConfigSetPayload> =
  registerMutationHandler<ConfigSetPayload>(
    'config_set',
    async (ctx: MutationContext<false>, payload: ConfigSetPayload): Promise<void> => {
      // ADR-0094 P11/P12: validate the payload BEFORE the write scope so a
      // malformed key/value throws without a partial write.
      if (typeof payload.key !== 'string' || payload.key.length === 0) {
        throw new Error(
          "config_set: 'key' is required and must be a non-empty string " +
            "(dot notation supported, e.g. 'swarm.topology')",
        );
      }
      if (payload.value === undefined) {
        throw new Error(
          "config_set: 'value' is required — pass null explicitly to clear the key",
        );
      }

      const key = payload.key;
      const value = payload.value;
      const scope = payload.scope || 'default';

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const raw = await handle.read<unknown>({ storeId: STORE_ID, key: 'root' });
        const store: ConfigStore = normalizeConfigStore(raw);

        // BUG-A (ADR-0082 / ADR-0094 Phase 8): a legacy (init-generated nested)
        // config.json cannot persist scoped values — fail loud rather than
        // silently dropping the value on the next reload.
        if (scope !== 'default' && store.shape === 'legacy') {
          throw new Error(
            'config_set: scope writes require MCP shape — legacy (init-generated) ' +
              'config.json cannot persist scoped values',
          );
        }

        if (scope === 'default') {
          if (store.shape === 'legacy') {
            // Write into the nested tree so the cli `config get` and MCP reads agree.
            setNestedValue(store.values, key, value);
          } else {
            store.values[key] = value;
          }
        } else {
          if (!store.scopes[scope]) {
            store.scopes[scope] = {};
          }
          if (key.includes('.')) {
            setNestedValue(store.scopes[scope], key, value);
          } else {
            store.scopes[scope][key] = value;
          }
        }

        store.updatedAt = new Date().toISOString();
        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
