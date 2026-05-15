// charter: dispatch
// Shared config-store shapes + helpers for archivist config_* handlers
// (ADR-0180 Phase 2). Ports the shape-tolerance logic from
// `cli/src/mcp-tools/config-tools.ts` (DEFAULT_CONFIG, detectShape,
// setNestedValue, getNestedValue, filterDangerousKeys, resolveValue) so the
// three migrated handlers (config_set, config_reset, config_import) keep the
// cli's MCP-flat vs init-generated legacy-nested discrimination verbatim.
//
// The FS-JSON substrate addresses the document by top-level field — the whole
// `ConfigStore` lives under `key: 'root'`, matching the `agents-json.ts` /
// `tasks/create.ts` convention. The cli kept `__shape` as a non-enumerable
// property re-derived from the raw config.json on every load; under the
// archivist seam the substrate round-trips JSON, so `shape` is a REAL
// enumerable field on the persisted document — `detectShape` still runs on
// load so a document written by the legacy cli surface (no `shape` field) is
// classified correctly, and the field is then carried through every write.

/** On-disk config shape — `mcp` is the flat `{values, scopes}` shape these
 *  tools historically wrote; `legacy` is the init-generated nested tree. */
export type ConfigShape = 'mcp' | 'legacy';

/** Config scope discriminator — `'default'` writes into `values`; any other
 *  string writes into `scopes[scope]`. Legacy-shape files reject non-default
 *  scopes (cli BUG-A). */
export type ConfigScope = string;

/** Persisted config-store document — mirrors the cli `ConfigStore` interface
 *  with `shape` promoted from a non-enumerable property to a real field. */
export interface ConfigStore {
  values: Record<string, unknown>;
  scopes: Record<string, Record<string, unknown>>;
  version: string;
  updatedAt: string;
  /** On-disk shape — preserved through every write. */
  shape: ConfigShape;
}

/** Default flat config — mirrors cli `DEFAULT_CONFIG`. */
export const DEFAULT_CONFIG: Record<string, unknown> = {
  'swarm.topology': 'mesh',
  'swarm.maxAgents': 10,
  'swarm.autoScale': true,
  'memory.persistInterval': 60000,
  'memory.maxEntries': 100000,
  'session.autoSave': true,
  'session.saveInterval': 300000,
  'logging.level': 'info',
  'logging.format': 'json',
  'security.sandboxEnabled': true,
  'security.pathValidation': true,
};

/** Dangerous prototype-pollution key segments — mirrors cli `DANGEROUS_KEYS`. */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const MAX_NESTING_DEPTH = 10;

/**
 * Classify a parsed config document. An "mcp" shape has BOTH `values` and
 * `scopes` as plain objects at the top level; anything else is "legacy".
 * Mirrors cli `detectShape`.
 */
export function detectShape(parsed: unknown): ConfigShape {
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const hasValues =
      obj.values !== null && typeof obj.values === 'object' && !Array.isArray(obj.values);
    const hasScopes =
      obj.scopes !== null && typeof obj.scopes === 'object' && !Array.isArray(obj.scopes);
    if (hasValues && hasScopes) return 'mcp';
  }
  return 'legacy';
}

/**
 * Normalize whatever the substrate returned under `key: 'root'` into a
 * `ConfigStore`. Handles three inputs:
 *   • undefined (never-written store)  → fresh mcp-shape store with defaults.
 *   • a document already carrying a `shape` field → trusted as-is.
 *   • a raw legacy/mcp document (written by the cli surface, no `shape`) →
 *     classified via `detectShape` and wrapped into a `ConfigStore`.
 *
 * Mirrors cli `loadConfigStore` shape discrimination — without the cli's
 * disk-IO or its silent `catch` (the substrate already fails loud on a
 * corrupt document per `feedback-no-fallbacks`).
 */
export function normalizeConfigStore(raw: unknown): ConfigStore {
  if (raw === undefined || raw === null) {
    return {
      values: { ...DEFAULT_CONFIG },
      scopes: {},
      version: '3.0.0',
      updatedAt: new Date().toISOString(),
      shape: 'mcp',
    };
  }

  const obj = raw as Record<string, unknown>;
  // A document this handler family previously wrote carries a real `shape`
  // field — trust it.
  if (obj.shape === 'mcp' || obj.shape === 'legacy') {
    return {
      values: (obj.values as Record<string, unknown>) ?? { ...DEFAULT_CONFIG },
      scopes: (obj.scopes as Record<string, Record<string, unknown>>) ?? {},
      version: (obj.version as string) ?? '3.0.0',
      updatedAt: (obj.updatedAt as string) ?? new Date().toISOString(),
      shape: obj.shape,
    };
  }

  // Raw document — classify it the way the cli surface would.
  const shape = detectShape(raw);
  if (shape === 'mcp') {
    return {
      values: (obj.values as Record<string, unknown>) ?? { ...DEFAULT_CONFIG },
      scopes: (obj.scopes as Record<string, Record<string, unknown>>) ?? {},
      version: (obj.version as string) ?? '3.0.0',
      updatedAt: (obj.updatedAt as string) ?? new Date().toISOString(),
      shape: 'mcp',
    };
  }
  // legacy — the parsed tree IS the values.
  return {
    values: obj,
    scopes: {},
    version: (obj.version as string) ?? '3.0.0',
    updatedAt: (obj.updatedAt as string) ?? new Date().toISOString(),
    shape: 'legacy',
  };
}

/** Walk a dotted key into a nested object — mirrors cli `getNestedValue`. */
export function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  const parts = key.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (
      current &&
      typeof current === 'object' &&
      part in (current as Record<string, unknown>)
    ) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Set a dotted key into a nested object — mirrors cli `setNestedValue`.
 *  Throws on excessive depth or a dangerous key segment (`feedback-no-fallbacks`). */
export function setNestedValue(obj: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  if (parts.length > MAX_NESTING_DEPTH) {
    throw new Error(`config: key exceeds maximum nesting depth of ${MAX_NESTING_DEPTH}`);
  }
  for (const part of parts) {
    if (DANGEROUS_KEYS.has(part)) {
      throw new Error(`config: dangerous key segment rejected: ${part}`);
    }
  }
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] as string;
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1] as string] = value;
}

/** Strip prototype-pollution keys from an import payload — mirrors cli
 *  `filterDangerousKeys`. */
export function filterDangerousKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!DANGEROUS_KEYS.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/** Resolve a key against a values tree — literal dotted key shadows a nested
 *  subtree. Mirrors cli `resolveValue`. */
export function resolveValue(values: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(values, key)) {
    return values[key];
  }
  return getNestedValue(values, key);
}
