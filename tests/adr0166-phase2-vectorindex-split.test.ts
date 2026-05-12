/**
 * ADR-0166 Phase 2 contract test — Option E split
 *
 * Asserts that `vectorBackend` has been split into orthogonal
 * `vectorIndex` (search axis) + `primaryStorage` (persistence axis),
 * with backward-compat alias semantics and loud-error gates for
 * not-yet-implemented values.
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentDB } from '../src/core/AgentDB.js';
import * as factory from '../src/backends/factory.js';

describe('ADR-0166 Phase 2 — vectorIndex + primaryStorage split', () => {
  it('vectorIndex takes precedence over deprecated vectorBackend', async () => {
    const spy = vi.spyOn(factory, 'createGuardedBackend');
    try {
      const db = new AgentDB({
        vectorBackend: 'hnswlib' as const,
        vectorIndex: 'ruvector' as const,
      });
      await db.initialize();
      expect(spy).toHaveBeenCalled();
      // vectorIndex wins, vectorBackend ignored
      expect(spy.mock.calls[0][0]).toBe('ruvector');
    } finally {
      spy.mockRestore();
    }
  });

  it('falls back to vectorBackend alias when vectorIndex is omitted', async () => {
    const spy = vi.spyOn(factory, 'createGuardedBackend');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const db = new AgentDB({ vectorBackend: 'ruvector' as const });
      await db.initialize();
      expect(spy.mock.calls[0][0]).toBe('ruvector');
      // ADR-0166 Phase 2: deprecation warning fires when only legacy field is set
      const warnedDeprecation = warnSpy.mock.calls.some((call) =>
        String(call[0] ?? '').includes('AgentDBConfig.vectorBackend')
      );
      expect(warnedDeprecation).toBe(true);
    } finally {
      spy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('does NOT emit deprecation warning when vectorIndex is set explicitly', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const db = new AgentDB({ vectorIndex: 'ruvector' as const });
      await db.initialize();
      const warnedDeprecation = warnSpy.mock.calls.some((call) =>
        String(call[0] ?? '').includes('AgentDBConfig.vectorBackend')
      );
      expect(warnedDeprecation).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('accepts primaryStorage="sqlite" without error', async () => {
    const db = new AgentDB({ primaryStorage: 'sqlite' });
    await expect(db.initialize()).resolves.toBeUndefined();
  });

  it('rejects primaryStorage with any non-"sqlite" value (loud-error per feedback-no-fallbacks)', async () => {
    // The TS type restricts this to 'sqlite' — cast to any to test the runtime guard.
    const db = new AgentDB({ primaryStorage: 'ruvector' as any });
    await expect(db.initialize()).rejects.toThrow(
      /primaryStorage='ruvector' is not supported/,
    );
  });

  it('accepts vectorIndex="sqlite-vec" when the extension is installed (Phase 3)', async () => {
    // ADR-0166 Phase 3 lifted the Phase 2 "not yet implemented" throw. If
    // sqlite-vec is installed (optionalDependency), init succeeds. If not
    // installed on this platform, init throws a loud "extension failed to load"
    // error — the assertion captures either case strictly (one of two, not none).
    const db = new AgentDB({ vectorIndex: 'sqlite-vec' as const });
    try {
      await db.initialize();
      // Loaded path
      expect(db.sqliteVecLoaded).toBe(true);
    } catch (err) {
      // Loud-error path: extension absent
      expect((err as Error).message).toMatch(
        /vectorIndex='sqlite-vec' requested but extension failed to load|requires native better-sqlite3 extension loading/,
      );
    }
  });
});
