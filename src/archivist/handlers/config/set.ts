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

/** Scope discriminator — mirrors the cli `config_set` inputSchema. `'default'`
 *  writes into `store.values` (top-level); any other string writes into
 *  `store.scopes[scope]`. Legacy-shape files reject scope !== 'default' per
 *  ADR-0094 Phase 8 BUG-A (config-tools.ts:321-332). */
export type ConfigScope = string;

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

// TODO(ADR-0180 Phase 5 wire-up): port the body of config-tools.ts
// `config_set` callsite once the dispatch boundary is wired through cli. The
// cli's bare `loadConfigStore` / `saveConfigStore` pair (no lock today)
// collapses to a single `ctx.substrate.withWrite` because the primitive owns
// the lock semantics. Validation branches (BUG-A legacy-scope rejection,
// dot-notation `setNestedValue` for legacy nested trees, MCP-flat direct key
// writes, dangerous-key filter via `DANGEROUS_KEYS`) port verbatim.
export const configSetHandler: GuardedWrite<ConfigSetPayload> =
  registerMutationHandler<ConfigSetPayload>(
    'config_set',
    async (ctx: MutationContext<false>, _payload: ConfigSetPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: config_set handler body pending Phase 5 wire-up; ' +
          'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/config-tools.ts config_set handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
