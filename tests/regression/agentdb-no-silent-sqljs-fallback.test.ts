/**
 * Regression: a native better-sqlite3 load failure must FAIL LOUD — AgentDB must
 * NOT silently degrade to the sql.js WASM engine (ADR-0082 no-silent-fallback /
 * fail-loud-fast).
 *
 * Why this rule, here: the WASM engine is slower AND has historically diverged
 * from better-sqlite3 on parameter binding + SAVEPOINT handling (the ADR-0285
 * P3/P4/P6 bug class). The OLD behavior — `catch { console.log('using WASM
 * fallback'); return initializeSqlJsWasm() }` — silently swapped engines, so a
 * daemon whose native build failed ran the divergent WASM path while every
 * better-sqlite3 test stayed green. That silent swap is exactly what made
 * P3/P4/P6 invisible in CI yet live in production.
 *
 * `resolveBetterSqlite3LoadFailure(error, env)` is the extracted decision: it
 * returns the actionable Error to throw by DEFAULT, and `null` ONLY when the WASM
 * engine was EXPLICITLY opted into via AGENTDB_ALLOW_SQLJS_FALLBACK. These tests
 * pin both branches without standing up the full `AgentDB.initialize()` pipeline.
 */

import { describe, it, expect } from 'vitest';
import { resolveBetterSqlite3LoadFailure } from '../../src/core/AgentDB.js';

describe('AgentDB better-sqlite3 load failure: fail loud, no silent sql.js fallback (ADR-0082)', () => {
  const nativeFailure = new Error('NODE_MODULE_VERSION 127 vs 137 — better_sqlite3.node ABI mismatch');

  it('DEFAULT (no opt-in): returns a loud, actionable Error — never silently WASM', () => {
    const e = resolveBetterSqlite3LoadFailure(nativeFailure, {});
    expect(e).toBeInstanceOf(Error);
    // surfaces WHY native failed (so the operator can fix the real problem)
    expect(e!.message).toContain('native better-sqlite3 failed to load');
    expect(e!.message).toContain(nativeFailure.message);
    // states the refusal + names the divergence class it protects against
    expect(e!.message).toMatch(/refusing to silently fall back/i);
    expect(e!.message).toMatch(/P3\/P4\/P6/);
    // actionable remediation
    expect(e!.message).toMatch(/npm rebuild better-sqlite3/);
    // names the explicit escape hatches
    expect(e!.message).toContain('AGENTDB_ALLOW_SQLJS_FALLBACK');
    expect(e!.message).toMatch(/forceWasm/);
  });

  it('explicit opt-in AGENTDB_ALLOW_SQLJS_FALLBACK=1 → returns null (caller proceeds to WASM)', () => {
    expect(resolveBetterSqlite3LoadFailure(nativeFailure, { AGENTDB_ALLOW_SQLJS_FALLBACK: '1' })).toBeNull();
  });

  it('opt-in accepts 1 | true | yes', () => {
    for (const v of ['1', 'true', 'yes']) {
      expect(
        resolveBetterSqlite3LoadFailure(nativeFailure, { AGENTDB_ALLOW_SQLJS_FALLBACK: v }),
      ).toBeNull();
    }
  });

  it('non-opt-in values (unset / 0 / false / empty / arbitrary) → fail loud', () => {
    const envs: NodeJS.ProcessEnv[] = [
      {},
      { AGENTDB_ALLOW_SQLJS_FALLBACK: '0' },
      { AGENTDB_ALLOW_SQLJS_FALLBACK: 'false' },
      { AGENTDB_ALLOW_SQLJS_FALLBACK: '' },
      { AGENTDB_ALLOW_SQLJS_FALLBACK: 'maybe' },
      { AGENTDB_ALLOW_SQLJS_FALLBACK: 'TRUE' }, // case-exact: not an opt-in
    ];
    for (const env of envs) {
      expect(resolveBetterSqlite3LoadFailure(nativeFailure, env)).toBeInstanceOf(Error);
    }
  });

  it('non-Error throwables are stringified into the reason', () => {
    const e = resolveBetterSqlite3LoadFailure('raw string failure', {});
    expect(e).toBeInstanceOf(Error);
    expect(e!.message).toContain('raw string failure');
  });
});
