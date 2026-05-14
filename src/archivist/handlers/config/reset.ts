// charter: dispatch
// config_reset mutation handler (ADR-0180 Phase 5 §Migration concerns).
// FS-JSON migrator for `.claude-flow/config.json` — paired sibling of
// `config_set` (set.ts). Shares the same store family + substrate seam; the
// rationale block in set.ts documents the family-level concerns
// (`makeFsJsonSubstrate` reuse, shape tolerance, ADR-0180 §Type enforcement).
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/config-tools.ts`
// `config_reset` handler — two action shapes:
//   • Specific-key reset (`payload.key` present): `delete` from `store.values`
//     (MCP-flat) or nested-walk delete (legacy), or `delete` from
//     `store.scopes[scope]`.
//   • Full reset (`payload.key` omitted): replace `store.values` with
//     `DEFAULT_CONFIG` (MCP-flat) or rebuild via `setNestedValue` (legacy —
//     BUG-B at config-tools.ts:506-518 prevents flat-into-nested hybrid).
// Both paths terminate in `saveConfigStore(store)`, which routes the
// `__shape`-preserving write the substrate now owns.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

import type { ConfigScope } from './set';

/** Mutation payload — mirrors the cli `config_reset` inputSchema. `key`
 *  optional: omitted means "reset the whole scope to defaults"; present means
 *  "reset just this key" (deleted from MCP-flat / scope, nested-walked for
 *  legacy). */
export interface ConfigResetPayload {
  readonly scope?: ConfigScope;
  readonly key?: string;
}

const STORE_ID = 'config' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of config-tools.ts
// `config_reset` callsite once the dispatch boundary is wired through cli.
// The cli's load/mutate/save pair collapses to a single
// `ctx.substrate.withWrite`. Both action shapes (specific-key, full-reset)
// port verbatim, including BUG-B's `setNestedValue` rebuild for legacy
// trees — the substrate is shape-agnostic, the handler keeps the shape
// discrimination.
export const configResetHandler: GuardedWrite<ConfigResetPayload> =
  registerMutationHandler<ConfigResetPayload>(
    'config_reset',
    async (ctx: MutationContext<false>, _payload: ConfigResetPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: config_reset handler body pending Phase 5 wire-up; ' +
          'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/config-tools.ts config_reset handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
