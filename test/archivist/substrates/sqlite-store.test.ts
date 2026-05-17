// charter: substrate-seam
// ADR-0181 task #99 commit 1 — `getByKey` + `list` unit tests for the
// production `makeSqliteSubstrate` factory.
//
// The SQLite carve-out is SQL-addressed (ADR-0166: 5 PERMANENT_SQLITE_CARVE_OUT
// controllers — episodes ⨝ episode_embeddings, skills ⨝ skill_embeddings,
// hierarchical_memory, causal_*). It has no shared (namespace, key) schema and
// no uniform pagination shape. The new `getByKey` / `list` ops at this seam
// therefore THROW — mirroring the existing `read` / `write` stubs which throw
// for the same reason (`feedback-no-fallbacks`: misroutes fail loud rather
// than silently no-op).
//
// These tests pin that throw-by-design contract. They do NOT exercise SQL
// queries via the substrate's `query({ sql, params })` operation — that lives
// in its own test surface.

import { describe, expect, it } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';

import { makeSqliteSubstrate } from '../../../src/archivist/substrates/sqlite-store.js';
import type {
  ReadCapableSubstrate,
  StoreId,
  SubstrateAccess,
} from '../../../src/archivist/types.js';

/**
 * Minimal in-memory `better-sqlite3` stub. The substrate factory does not
 * actually call any db method during `getByKey` / `list` (both throw before
 * touching the db), so we only need the surface to be constructible.
 */
function makeStubDb(): BetterSqlite3.Database {
  const stub = {
    prepare(): never {
      throw new Error('stub-db: prepare() should not be called for these tests');
    },
    transaction(fn: () => unknown): () => unknown {
      return () => fn();
    },
  };
  return stub as unknown as BetterSqlite3.Database;
}

function asReadable(access: SubstrateAccess): ReadCapableSubstrate {
  return access as unknown as ReadCapableSubstrate;
}

const STORE_ID = 'agentdb_causal_recall' as StoreId;

describe('makeSqliteSubstrate — getByKey + list (ADR-0181 task #99 commit 1)', () => {
  describe('getByKey', () => {
    it('throws because the SQLite carve-out is SQL-addressed (no key/value model)', async () => {
      const access = makeSqliteSubstrate(makeStubDb());
      await expect(
        asReadable(access).getByKey({
          storeId: STORE_ID,
          namespace: 'ns-1',
          key: 'k-1',
        }),
      ).rejects.toThrow(/getByKey is not supported.*SQL-addressed/s);
    });

    it('throw message points the caller at handle.db / query for the real escape hatch', async () => {
      const access = makeSqliteSubstrate(makeStubDb());
      await expect(
        asReadable(access).getByKey({ storeId: STORE_ID, namespace: 'n', key: 'k' }),
      ).rejects.toThrow(/handle\.db/);
    });
  });

  describe('list', () => {
    it('throws for the same reason as getByKey (no shared pagination shape)', async () => {
      const access = makeSqliteSubstrate(makeStubDb());
      await expect(
        asReadable(access).list({ storeId: STORE_ID, namespace: 'ns-1', limit: 10 }),
      ).rejects.toThrow(/list is not supported.*SQL-addressed/s);
    });

    it('throws regardless of whether namespace / limit / offset are supplied', async () => {
      const access = makeSqliteSubstrate(makeStubDb());
      // No filters
      await expect(asReadable(access).list({ storeId: STORE_ID })).rejects.toThrow(
        /list is not supported/,
      );
      // limit only
      await expect(asReadable(access).list({ storeId: STORE_ID, limit: 5 })).rejects.toThrow(
        /list is not supported/,
      );
      // offset only
      await expect(asReadable(access).list({ storeId: STORE_ID, offset: 10 })).rejects.toThrow(
        /list is not supported/,
      );
    });
  });
});
