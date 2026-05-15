// charter: dispatch
// ADR-0181 Phase 5 DA-memo CF#3 — namespace harmonization.
//
// Tests for `registerMutationHandlerAlias` / `registerReadHandlerAlias` from
// `src/archivist/registration.ts`. Aliases let two dispatch names resolve to
// the same registered handler so the cli's plural-hyphenated MCP tool names
// (`hooks_pre-task`) and the archivist's singular-underscored canonical
// names (`hook_pre_task`) can coexist without renaming either user-facing
// surface.
//
// Coverage:
//   1. Alias resolves to the same handler entry as the canonical name.
//   2. Aliasing a non-existent canonical throws fail-loud.
//   3. Aliasing a name already in use (mutation OR read registry) throws.
//   4. The 4 hook aliases registered by `handlers/hooks/index.ts` are present
//      after the barrel is imported.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerMutationHandler,
  registerReadHandler,
  registerMutationHandlerAlias,
  registerReadHandlerAlias,
  getRegistration,
  __resetRegistry__,
} from '../../src/archivist/registration.js';

describe('registerMutationHandlerAlias', () => {
  beforeEach(() => {
    __resetRegistry__();
  });

  it('alias name resolves to the canonical handler entry', async () => {
    const calls: Array<{ from: string; payload: unknown }> = [];
    registerMutationHandler<{ value: number }>('canonical_tool', async (_ctx, payload) => {
      calls.push({ from: 'canonical_tool', payload });
    });

    registerMutationHandlerAlias('alias_tool', 'canonical_tool');

    const canon = getRegistration('canonical_tool');
    const alias = getRegistration('alias_tool');
    expect(canon?.kind).toBe('mutation');
    expect(alias?.kind).toBe('mutation');
    if (canon?.kind === 'mutation' && alias?.kind === 'mutation') {
      // Same entry object — alias shares handler, invariants, cacheScope.
      expect(alias.entry).toBe(canon.entry);
    }
  });

  it('throws when canonical name is not registered', () => {
    expect(() => registerMutationHandlerAlias('alias_x', 'never_registered')).toThrow(
      /cannot alias.*canonical handler not registered/,
    );
  });

  it('throws when alias name is already a mutation handler', () => {
    registerMutationHandler<unknown>('canonical_a', async () => {});
    registerMutationHandler<unknown>('canonical_b', async () => {});
    expect(() => registerMutationHandlerAlias('canonical_b', 'canonical_a')).toThrow(
      /already registered.*alias collision/,
    );
  });

  it('throws when alias name collides with a read handler', () => {
    registerMutationHandler<unknown>('canonical_c', async () => {});
    registerReadHandler<unknown, unknown>('reader_z', async () => null);
    expect(() => registerMutationHandlerAlias('reader_z', 'canonical_c')).toThrow(
      /already registered as a read handler/,
    );
  });
});

describe('registerReadHandlerAlias', () => {
  beforeEach(() => {
    __resetRegistry__();
  });

  it('alias name resolves to the canonical read entry', async () => {
    registerReadHandler<{ q: string }, string>('canonical_read', async (_ctx, p) => p.q);

    registerReadHandlerAlias('alias_read', 'canonical_read');

    const canon = getRegistration('canonical_read');
    const alias = getRegistration('alias_read');
    expect(canon?.kind).toBe('read');
    expect(alias?.kind).toBe('read');
    if (canon?.kind === 'read' && alias?.kind === 'read') {
      expect(alias.entry).toBe(canon.entry);
    }
  });

  it('throws when canonical read is not registered', () => {
    expect(() => registerReadHandlerAlias('alias_y', 'never_registered_read')).toThrow(
      /cannot alias.*canonical read handler not registered/,
    );
  });

  it('throws when alias name collides with a mutation handler', () => {
    registerReadHandler<unknown, unknown>('reader_a', async () => null);
    registerMutationHandler<unknown>('writer_b', async () => {});
    expect(() => registerReadHandlerAlias('writer_b', 'reader_a')).toThrow(
      /already registered as a mutation handler/,
    );
  });
});

describe('CF#3 hook aliases (integration)', () => {
  beforeEach(() => {
    __resetRegistry__();
  });

  it('importing handlers/hooks barrel registers both canonical names and cli-spelled aliases', async () => {
    // Re-import after __resetRegistry__ — the side-effects in the hooks
    // handler files re-run because we use a dynamic import with a cache-bust.
    // Vitest's module cache is per-test-file, so first dynamic import after
    // reset re-triggers `registerMutationHandler` calls.
    await import('../../src/archivist/handlers/hooks/index.js');

    const canonicalNames = ['hook_pre_task', 'hook_post_task', 'hook_post_edit', 'hook_session_end'];
    const aliasNames = ['hooks_pre-task', 'hooks_post-task', 'hooks_post-edit', 'hooks_session-end'];

    for (const name of [...canonicalNames, ...aliasNames]) {
      const reg = getRegistration(name);
      expect(reg, `expected handler registered under '${name}'`).toBeDefined();
      expect(reg?.kind).toBe('mutation');
    }

    // Each alias must point at the same entry as its canonical counterpart —
    // proves the alias is a true re-registration of the same handler, not a
    // separate registration that happens to share a name.
    for (let i = 0; i < canonicalNames.length; i++) {
      const canon = getRegistration(canonicalNames[i]);
      const alias = getRegistration(aliasNames[i]);
      if (canon?.kind === 'mutation' && alias?.kind === 'mutation') {
        expect(alias.entry, `alias '${aliasNames[i]}' must share entry with '${canonicalNames[i]}'`).toBe(
          canon.entry,
        );
      } else {
        throw new Error(
          `expected both '${canonicalNames[i]}' and '${aliasNames[i]}' to be mutation handlers`,
        );
      }
    }
  });
});
