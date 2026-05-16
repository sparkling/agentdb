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

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';

import type { ConfigScope } from './set.js';
import {
  type ConfigStore,
  DEFAULT_CONFIG,
  getNestedValue,
  normalizeConfigStore,
  setNestedValue,
} from './config-store.js';

/** Mutation payload — mirrors the cli `config_reset` inputSchema. `key`
 *  optional: omitted means "reset the whole scope to defaults"; present means
 *  "reset just this key" (deleted from MCP-flat / scope, nested-walked for
 *  legacy). */
export interface ConfigResetPayload {
  readonly scope?: ConfigScope;
  readonly key?: string;
}

const STORE_ID = 'config' as StoreId;

// Ported from cli/src/mcp-tools/config-tools.ts `config_reset` handler
// (lines 473-538). The cli's bare `loadConfigStore` / `saveConfigStore` pair
// collapses to a single `ctx.substrate.withWrite` — the substrate primitive
// supplies the O_EXCL lock.
//
// Both action shapes port verbatim:
//   • specific-key (`payload.key` present): delete from `values` (MCP-flat),
//     nested-walk delete (legacy), or delete from `scopes[scope]`.
//   • full-reset (`payload.key` omitted): replace `values` with DEFAULT_CONFIG
//     (MCP-flat) or rebuild via `setNestedValue` (legacy — BUG-B: DEFAULT_CONFIG
//     is a FLAT dotted-key map; assigning it directly to a legacy nested tree
//     would produce a hybrid file, so it is rebuilt nested).
export const configResetHandler: GuardedWrite<ConfigResetPayload> =
  registerMutationHandler<ConfigResetPayload>(
    'config_reset',
    async (ctx: MutationContext<false>, payload: ConfigResetPayload): Promise<void> => {
      const scope = payload.scope || 'default';
      const key = payload.key;

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const raw = await handle.read<unknown>({ storeId: STORE_ID, key: 'root' });
        const store: ConfigStore = normalizeConfigStore(raw);

        if (key) {
          // Reset a specific key.
          if (scope === 'default') {
            if (key in store.values) {
              delete store.values[key];
            } else if (
              store.shape === 'legacy' &&
              getNestedValue(store.values, key) !== undefined
            ) {
              // Nested-walk delete for a legacy tree.
              const parts = key.split('.');
              let cur: Record<string, unknown> | undefined = store.values;
              for (let i = 0; i < parts.length - 1; i++) {
                cur = cur[parts[i] as string] as Record<string, unknown> | undefined;
                if (!cur) break;
              }
              if (cur) {
                delete cur[parts[parts.length - 1] as string];
              }
            }
          } else if (store.scopes[scope] && key in store.scopes[scope]) {
            delete store.scopes[scope][key];
          }
        } else {
          // Reset the whole scope to defaults.
          if (scope === 'default') {
            if (store.shape === 'legacy') {
              // BUG-B: rebuild the nested tree from the flat DEFAULT_CONFIG so
              // the file stays nested instead of becoming a flat/nested hybrid.
              for (const k of Object.keys(store.values)) {
                delete store.values[k];
              }
              for (const [k, v] of Object.entries(DEFAULT_CONFIG)) {
                setNestedValue(store.values, k, v);
              }
            } else {
              store.values = { ...DEFAULT_CONFIG };
            }
          } else if (store.scopes[scope]) {
            delete store.scopes[scope];
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
