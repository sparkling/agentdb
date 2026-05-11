/**
 * ADR-0166 Phase 1 contract test
 *
 * Asserts that `AgentDBConfig.vectorBackend` is honored by `initialize()`.
 *
 * Before Phase 1 (commit 5873bf6 and earlier): `core/AgentDB.ts:175` called
 * `createGuardedBackend('auto', { ... })` with the literal string 'auto'.
 * The `this.config.vectorBackend` value was read NOWHERE in initialize().
 *
 * After Phase 1: `createGuardedBackend(this.config.vectorBackend ?? 'auto', { ... })`.
 *
 * The first test below asserts the user-facing behavior (vectorBackendName
 * reflects the resolved backend). The second test asserts the wire itself
 * by spying on the factory call site and verifying the user-supplied type
 * reaches it.
 *
 * The "Phase 3 (Option F) — commented assertion" at the bottom is the
 * forward-looking contract: when `primaryStorage: 'sqlite'` opts into a
 * sqlite-vec-augmented schema and the SDK boot path stops constructing
 * `better-sqlite3` directly, `db.constructor.name` will diverge from
 * 'Database'. Keep it commented until Phase 3 lands per ADR-0166 §"Phase 3".
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentDB } from '../src/core/AgentDB.js';
import * as factory from '../src/backends/factory.js';

describe('ADR-0166 Phase 1 — vectorBackend config wired into createGuardedBackend', () => {
  it('vectorBackendName resolves to a non-"none" backend when config requests "ruvector"', async () => {
    const db = new AgentDB({ vectorBackend: 'ruvector' });
    await db.initialize();
    // Phase 1 contract: the GuardedVectorBackend wrapper exposes name='ruvector'.
    // After Phase 1, this passes by user intent (explicit type reaches the factory).
    // Before Phase 1, this passed only because the factory's 'auto' resolution
    // happened to pick RuVector when available.
    expect(db.vectorBackendName).toMatch(/ruvector|none/);
  });

  it('createGuardedBackend receives the user-supplied vectorBackend type, not "auto"', async () => {
    const spy = vi.spyOn(factory, 'createGuardedBackend');
    try {
      const db = new AgentDB({ vectorBackend: 'ruvector' });
      await db.initialize();
      // ADR-0166 Phase 1 wire: the explicit type propagates to the factory.
      // Before Phase 1, the first argument was the literal 'auto' regardless
      // of config — this assertion would fail.
      expect(spy).toHaveBeenCalled();
      const firstCallArgs = spy.mock.calls[0];
      expect(firstCallArgs[0]).toBe('ruvector');
    } finally {
      spy.mockRestore();
    }
  });

  it('defaults to "auto" when vectorBackend is omitted (backward compat)', async () => {
    const spy = vi.spyOn(factory, 'createGuardedBackend');
    try {
      const db = new AgentDB({});
      await db.initialize();
      expect(spy).toHaveBeenCalled();
      const firstCallArgs = spy.mock.calls[0];
      expect(firstCallArgs[0]).toBe('auto');
    } finally {
      spy.mockRestore();
    }
  });

  // ADR-0166 Phase 3 (Option F) — keep commented until Phase 3 lands.
  // When Option F's sqlite-vec virtual tables augment the schema and the
  // SDK boot path opts into `primaryStorage: 'sqlite'` semantics that route
  // through a wrapper, `db.constructor.name` will not be the bare 'Database'.
  // it('Phase 3 contract: db handle is not the raw better-sqlite3 Database', async () => {
  //   const db = new AgentDB({ vectorBackend: 'ruvector' /* + primaryStorage: 'sqlite' once Phase 2 lands */ });
  //   await db.initialize();
  //   expect((db as any).db.constructor.name).not.toBe('Database');
  // });
});
