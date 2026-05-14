// charter: guard-policy
// Guard composition + registration (ADR-0180 Follow-up #6, lines ~374-413).
// Default 5 guards: size, quality, pii, schema, rate-limit. Each runs independently
// (no short-circuit) so the audit entry captures all relevant policy signals.
// Algebra: ANY veto rejects; warn passes through but is recorded; pass is silent.
// Guard exceptions materialize as synthetic `veto` verdicts per
// `feedback-best-effort-must-rethrow-fatals` (fail-closed, not upstream's degraded-mode).

import type { GuardName, GuardOutcome, GuardVerdict } from './guards-types';
export type { GuardName, GuardOutcome, GuardVerdict } from './guards-types';
export type {
  SizeVerdict,
  QualityVerdict,
  PiiVerdict,
  SchemaVerdict,
  RateLimitVerdict,
  PluginVerdict,
} from './guards-types';

/**
 * Subset of `MutationContext` exposed to guards. Guards have NO access to
 * `SubstrateAccess` — they receive intent metadata + payload only (per #6
 * "Plugin contract"). Same restriction applies to built-in guards.
 */
export interface GuardContext {
  readonly originatingTool: string;
  readonly timestamp: number;
}

/** Guard function shape — registered via `registerGuard(name, fn)`. */
export type GuardFn = (
  intent: { readonly tool: string },
  payload: unknown,
  ctx: GuardContext,
) => Promise<GuardVerdict> | GuardVerdict;

/** Reserved built-in names. Plugins must namespace as `plugin-name/guard-name`. */
const RESERVED_GUARD_NAMES: ReadonlySet<GuardName> = new Set([
  'size',
  'quality',
  'pii',
  'schema',
  'rate-limit',
]);

/** Registry of guards — keyed by guard name. Internal to the archivist module. */
const guardRegistry = new Map<string, GuardFn>();

/**
 * Register a guard. Plugin guards must use a namespaced name (`plugin/<guard>`);
 * reserved names cannot be re-registered. Re-registration of a non-reserved name
 * replaces the prior implementation (test fixtures rely on this).
 */
export function registerGuard(name: string, fn: GuardFn): void {
  if (RESERVED_GUARD_NAMES.has(name as GuardName) && guardRegistry.has(name)) {
    throw new Error(`archivist: cannot re-register reserved guard '${name}'`);
  }
  if (!RESERVED_GUARD_NAMES.has(name as GuardName) && !name.includes('/')) {
    throw new Error(`archivist: plugin guard '${name}' must be namespaced as 'plugin-name/guard-name'`);
  }
  guardRegistry.set(name, fn);
}

/** Internal — list registered guards. Used by the archivist's compose step. */
export function listGuards(): ReadonlyArray<[string, GuardFn]> {
  return Array.from(guardRegistry.entries());
}

/**
 * Compose verdicts. Runs all guards independently (no short-circuit on first
 * veto); exceptions become synthetic `veto` verdicts. Returns the full verdict
 * array AND the aggregate outcome.
 */
export interface ComposedVerdicts {
  readonly verdicts: ReadonlyArray<GuardVerdict>;
  /** Aggregate per the `veto > warn > pass` algebra. */
  readonly outcome: GuardOutcome;
}

export async function composeGuards(
  intent: { readonly tool: string },
  payload: unknown,
  ctx: GuardContext,
): Promise<ComposedVerdicts> {
  const verdicts: GuardVerdict[] = [];
  for (const [name, fn] of guardRegistry) {
    try {
      const verdict = await fn(intent, payload, ctx);
      verdicts.push(verdict);
    } catch (err) {
      verdicts.push({
        guard: name,
        outcome: 'veto',
        reason: `guard error: ${(err as Error).message}`,
      } as GuardVerdict);
    }
  }
  const outcome: GuardOutcome = verdicts.some((v) => v.outcome === 'veto')
    ? 'veto'
    : verdicts.some((v) => v.outcome === 'warn')
      ? 'warn'
      : 'pass';
  return { verdicts, outcome };
}
