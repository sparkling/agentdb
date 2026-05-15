// charter: dispatch
// config_import mutation handler (ADR-0180 Phase 5 §Migration concerns).
// FS-JSON migrator for `.claude-flow/config.json` — third sibling alongside
// `config_set` (set.ts) and `config_reset` (reset.ts). Shares the same store
// family + substrate seam; the rationale block in set.ts documents the
// family-level concerns (`makeFsJsonSubstrate` reuse, shape tolerance,
// ADR-0180 §Type enforcement).
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/config-tools.ts`
// `config_import` handler — bulk-assigns `Record<string, unknown>` into
// `store.values` (default scope) or `store.scopes[scope]` with `merge` flag
// toggling Object.assign vs. replace semantics. The cli surface guards against
// legacy-shape footguns:
//   • scope !== 'default' rejected on legacy shape (config-tools.ts:607-616) —
//     `saveConfigStore`'s legacy branch persists only `store.values`, so
//     scoped imports would silently drop on reload (BUG-A mirror).
//   • Top-level `values` / `scopes` keys in a legacy-shape import payload
//     rejected (config-tools.ts:617-646) — would inject MCP-shape hybrid into
//     the nested init tree. Empty `{}` payloads are explicitly a no-op.
//   • `__proto__` / `constructor` / `prototype` keys filtered via
//     `filterDangerousKeys` (config-tools.ts:172-182) before any assign.
// All three guards port verbatim into the handler body at wire-up.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

import type { ConfigScope } from './set.js';

/** Mutation payload — mirrors the cli `config_import` inputSchema. `config`
 *  is a free-shape `Record<string, unknown>` (the cli accepts arbitrary JSON);
 *  validation happens at the handler body per the guards listed in the file
 *  rationale above. `merge` defaults to `true` (Object.assign semantics);
 *  `false` replaces the scope (default scope replaces against DEFAULT_CONFIG
 *  baseline; non-default scopes replace empty). */
export interface ConfigImportPayload {
  readonly config: Record<string, unknown>;
  readonly scope?: ConfigScope;
  readonly merge?: boolean;
}

const STORE_ID = 'config' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of config-tools.ts
// `config_import` callsite once the dispatch boundary is wired through cli.
// The cli's load/validate/mutate/save pair collapses to a single
// `ctx.substrate.withWrite`. The three legacy-shape guards (scoped-import
// rejection, top-level `values` / `scopes` rejection, dangerous-key filter)
// port verbatim because they're correctness gates — not durability concerns
// the substrate owns.
export const configImportHandler: GuardedWrite<ConfigImportPayload> =
  registerMutationHandler<ConfigImportPayload>(
    'config_import',
    async (ctx: MutationContext<false>, _payload: ConfigImportPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: config_import handler body pending Phase 5 wire-up; ' +
          'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/config-tools.ts config_import handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
