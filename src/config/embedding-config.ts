/**
 * Shared embedding configuration helper (ADR-0069 A4)
 *
 * Centralizes config-chain reads that would otherwise be duplicated across
 * multiple files. Callers import from here instead of defining local copies.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Reads ewcLambda from the substrate config chain (.claude-flow/embeddings.json).
 * Returns `fallback` when the config file is absent (expected on fresh installs)
 * or when the value is missing/invalid.
 *
 * ADR-0069 A5: the canonical fallback is 2000 (not 1000) — callers pass their
 * preferred fallback so this helper stays decoupled from hardcoded values.
 */
export function readEwcLambdaFromConfig(fallback: number): number {
  const configPath = join(process.cwd(), '.claude-flow', 'embeddings.json');

  if (!existsSync(configPath)) return fallback;

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const cfg = JSON.parse(raw);
    const val = cfg?.neural?.ewcLambda ?? cfg?.ewcLambda;
    if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
      return val;
    }
    return fallback;
  } catch (err) {
    console.warn(`[embedding-config] readEwcLambdaFromConfig failed: ${(err as Error).message}`);
    return fallback;
  }
}
