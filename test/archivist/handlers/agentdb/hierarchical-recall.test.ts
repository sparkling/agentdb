// charter: dispatch
// Per-handler unit test for `agentdb_hierarchical_recall` (ADR-0181 Phase 7).
//
// Covers the SQL-port contract:
//   1. `ctx.substrate.query<HierarchicalRow>(...)` is invoked with the
//      importance-ordered `SELECT ... FROM hierarchical_memory ORDER BY
//      importance DESC LIMIT ?` SQL — tier predicate pushed into WHERE when
//      the payload supplies it.
//   2. Each returned row is projected onto a `HierarchicalRecallHit`
//      (key from metadata.key with row.id fallback; value = row.content;
//      score = importance) with sequential per-result `provenance.rank`.
//   3. Tier values that are not one of working/episodic/semantic skip silently
//      (corrupt-data tolerance — no synthetic tier passthrough).
//   4. Malformed metadata JSON throws fail-loud (`feedback-no-fallbacks`).
//
// The handler no longer depends on `ctx.capabilities.requireEmbeddingScorer()` —
// the SQLite `hierarchical_memory` schema has no embedding column, so
// importance is the canonical rank signal exposed to readers (see file header
// of the handler module).

import { describe, it, expect } from 'vitest';
import { withTestReadContext } from '../../../../src/archivist/testing/index.js';
import { hierarchicalRecallHandler } from '../../../../src/archivist/handlers/agentdb/hierarchical-recall.js';
import type { StoreId, SubstrateAccess, SubstrateHandle } from '../../../../src/archivist/types.js';

interface FakeRow {
  readonly id: string;
  readonly content: string;
  readonly importance: number;
  readonly tier: string;
  readonly created_at: number;
  readonly metadata: string | null;
}

interface QueryCall {
  readonly storeId: StoreId;
  readonly sql: string;
  readonly params: Record<string, unknown>;
}

function makeSqlReadFake(rows: ReadonlyArray<FakeRow>): {
  access: SubstrateAccess;
  calls: ReadonlyArray<QueryCall>;
} {
  const calls: QueryCall[] = [];
  const handle: SubstrateHandle & {
    query: (scope: { storeId: StoreId; predicate: { sql: string; params?: Record<string, unknown> } }) => Promise<ReadonlyArray<unknown>>;
  } = {
    async read<R>(): Promise<R | undefined> {
      throw new Error('sql read fake: handle.read is not supported');
    },
    async write(): Promise<void> {
      throw new Error('sql read fake: handle.write is not supported');
    },
    async withWrite<T>(
      _scope: { storeId: StoreId },
      fn: (h: SubstrateHandle) => Promise<T>,
    ): Promise<T> {
      return fn(handle);
    },
    async withBulkWrite(): Promise<void> {
      throw new Error('sql read fake: handle.withBulkWrite is not supported');
    },
    async query(scope) {
      calls.push({ storeId: scope.storeId, sql: scope.predicate.sql, params: scope.predicate.params ?? {} });
      return rows;
    },
  };
  return { access: handle as unknown as SubstrateAccess, calls };
}

function row(
  id: string,
  importance: number,
  tier: string,
  content: string,
  metadata: Record<string, unknown> | null = null,
): FakeRow {
  return {
    id,
    content,
    importance,
    tier,
    created_at: 1_700_000_000,
    metadata: metadata === null ? null : JSON.stringify(metadata),
  };
}

describe('agentdb_hierarchical_recall handler (ADR-0181 Phase 7 SQL port)', () => {
  it('issues importance-ordered SELECT against hierarchical_memory and projects ranked hits', async () => {
    const { access, calls } = makeSqlReadFake([
      row('hier-1', 0.91, 'semantic', 'recall plan A', { key: 'plan/a' }),
      row('hier-2', 0.74, 'episodic', 'event detail', { key: 'evt/2' }),
    ]);

    const { result } = await withTestReadContext(
      hierarchicalRecallHandler,
      { query: 'recall the plans', topK: 5 },
      { substrate: access },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].storeId).toBe('agentdb_hierarchical_store');
    expect(calls[0].sql).toMatch(/FROM hierarchical_memory/);
    expect(calls[0].sql).toMatch(/ORDER BY importance DESC/);
    expect(calls[0].sql).toMatch(/LIMIT @limit/);
    expect(calls[0].params).toEqual({ limit: 5 });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      item: { key: 'plan/a', value: 'recall plan A', tier: 'semantic', score: 0.91 },
      score: 0.91,
      provenance: {
        storeId: 'hierarchical:semantic',
        matchType: 'semantic',
        rawScore: 0.91,
        rank: 1,
        matchedField: 'importance',
      },
    });
    expect(result[1].item).toEqual({
      key: 'evt/2',
      value: 'event detail',
      tier: 'episodic',
      score: 0.74,
    });
    expect(result[1].provenance.rank).toBe(2);
    expect(result[1].provenance.storeId).toBe('hierarchical:episodic');
  });

  it('pushes the tier filter into the SQL WHERE clause and forwards the parameter', async () => {
    const { access, calls } = makeSqlReadFake([
      row('s1', 0.85, 'semantic', 's-content-1', { key: 's1' }),
      row('s2', 0.70, 'semantic', 's-content-2', { key: 's2' }),
    ]);

    const { result } = await withTestReadContext(
      hierarchicalRecallHandler,
      { query: 'q', tier: 'semantic', topK: 5 },
      { substrate: access },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/WHERE tier = @tier/);
    expect(calls[0].params).toEqual({ limit: 5, tier: 'semantic' });

    expect(result.map((r) => r.item.key)).toEqual(['s1', 's2']);
    expect(result.map((r) => r.provenance.rank)).toEqual([1, 2]);
    expect(result.every((r) => r.item.tier === 'semantic')).toBe(true);
  });

  it('uses row.id as the key when metadata.key is absent', async () => {
    const { access } = makeSqlReadFake([
      row('hier-only-content', 0.5, 'working', 'inline payload', null),
    ]);

    const { result } = await withTestReadContext(
      hierarchicalRecallHandler,
      { query: 'q' },
      { substrate: access },
    );

    expect(result).toHaveLength(1);
    expect(result[0].item).toEqual({
      key: 'hier-only-content',
      value: 'inline payload',
      tier: 'working',
      score: 0.5,
    });
  });

  it('skips rows whose tier value is not one of working/episodic/semantic', async () => {
    const { access } = makeSqlReadFake([
      row('bad-tier', 0.95, 'archived', 'x'),
      row('ok', 0.7, 'episodic', 'z', { key: 'z' }),
    ]);

    const { result } = await withTestReadContext(
      hierarchicalRecallHandler,
      { query: 'q' },
      { substrate: access },
    );

    expect(result).toHaveLength(1);
    expect(result[0].item.key).toBe('z');
    expect(result[0].provenance.rank).toBe(1);
  });

  it('throws fail-loud when metadata is not valid JSON (no synthetic fallback)', async () => {
    const malformed: FakeRow = {
      id: 'bad-meta',
      content: 'x',
      importance: 0.9,
      tier: 'semantic',
      created_at: 1,
      metadata: '{not-json',
    };
    const { access } = makeSqlReadFake([malformed]);

    await expect(
      withTestReadContext(hierarchicalRecallHandler, { query: 'q' }, { substrate: access }),
    ).rejects.toThrow(/agentdb_hierarchical_recall metadata for row 'bad-meta' is not valid JSON/);
  });

  it('throws when metadata JSON-parses to a non-object (array / scalar)', async () => {
    const wrongShape: FakeRow = {
      id: 'array-meta',
      content: 'x',
      importance: 0.9,
      tier: 'semantic',
      created_at: 1,
      metadata: '[1,2,3]',
    };
    const { access } = makeSqlReadFake([wrongShape]);

    await expect(
      withTestReadContext(hierarchicalRecallHandler, { query: 'q' }, { substrate: access }),
    ).rejects.toThrow(/must JSON-parse to an object/);
  });

  it('returns empty array when the substrate has no rows', async () => {
    const { access } = makeSqlReadFake([]);

    const { result } = await withTestReadContext(
      hierarchicalRecallHandler,
      { query: 'no matches' },
      { substrate: access },
    );

    expect(result).toEqual([]);
  });

  it('defaults topK to 5 when payload omits it', async () => {
    const { access, calls } = makeSqlReadFake([]);

    await withTestReadContext(hierarchicalRecallHandler, { query: 'q' }, { substrate: access });

    expect(calls[0].params).toEqual({ limit: 5 });
  });
});
