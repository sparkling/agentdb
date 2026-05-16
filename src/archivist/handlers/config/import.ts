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

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';
import { importInvariants } from '../../invariants/config/import.js';

import type { ConfigScope } from './set.js';
import {
  type ConfigStore,
  DEFAULT_CONFIG,
  filterDangerousKeys,
  normalizeConfigStore,
} from './config-store.js';

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

/** Is `v` a non-empty plain object? Used by the legacy-shape import guards. */
function isNonEmptyObject(v: unknown): boolean {
  return (
    v !== undefined &&
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v as Record<string, unknown>).length > 0
  );
}

// Ported from cli/src/mcp-tools/config-tools.ts `config_import` handler
// (lines 591-672). The cli's load/validate/mutate/save pair collapses to a
// single `ctx.substrate.withWrite` — the substrate primitive supplies the
// O_EXCL lock.
//
// The three legacy-shape guards port verbatim (`feedback-no-fallbacks` —
// correctness gates, all fail loud):
//   • scoped imports against a legacy file are rejected (BUG-A mirror — the
//     legacy persist path only writes `values`, so the scope would drop).
//   • a default-scope import payload carrying a non-empty top-level `values`
//     or `scopes` key is rejected against a legacy file (would inject an
//     MCP-shape hybrid into the nested init tree). Empty `{}` is a no-op,
//     allowed.
//   • `__proto__` / `constructor` / `prototype` keys filtered via
//     `filterDangerousKeys` before any assign.
export const configImportHandler: GuardedWrite<ConfigImportPayload> =
  registerMutationHandler<ConfigImportPayload>(
    'config_import',
    async (ctx: MutationContext<false>, payload: ConfigImportPayload): Promise<void> => {
      if (
        payload.config === undefined ||
        payload.config === null ||
        typeof payload.config !== 'object' ||
        Array.isArray(payload.config)
      ) {
        throw new Error("config_import: 'config' is required and must be an object");
      }

      const config = filterDangerousKeys(payload.config);
      const scope = payload.scope || 'default';
      const merge = payload.merge !== false;

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const raw = await handle.read<unknown>({ storeId: STORE_ID, key: 'root' });
        const store: ConfigStore = normalizeConfigStore(raw);

        // Guard 1 (BUG-A mirror): a legacy file cannot persist scoped values.
        if (scope !== 'default' && store.shape === 'legacy') {
          throw new Error(
            'config_import: scope imports require MCP shape — legacy ' +
              '(init-generated) config.json cannot persist scoped values',
          );
        }

        // Guard 2: a legacy file rejects a payload carrying a non-empty
        // top-level `values` / `scopes` key (would corrupt the nested tree).
        if (store.shape === 'legacy') {
          const scopesIsNonEmpty = isNonEmptyObject(config.scopes);
          const valuesIsNonEmpty = isNonEmptyObject(config.values);
          if (scopesIsNonEmpty || valuesIsNonEmpty) {
            const offending = [
              scopesIsNonEmpty ? '`scopes`' : null,
              valuesIsNonEmpty ? '`values`' : null,
            ]
              .filter(Boolean)
              .join(' / ');
            throw new Error(
              `config_import: legacy config.json rejects import payloads carrying a ` +
                `top-level ${offending} key — would corrupt the nested tree`,
            );
          }
        }

        if (scope === 'default') {
          if (merge) {
            Object.assign(store.values, config);
          } else {
            store.values = { ...DEFAULT_CONFIG, ...config };
          }
        } else {
          if (!store.scopes[scope] || !merge) {
            store.scopes[scope] = {};
          }
          Object.assign(store.scopes[scope], config);
        }

        store.updatedAt = new Date().toISOString();
        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: importInvariants,
      cacheScope: 'store',
    },
  );
