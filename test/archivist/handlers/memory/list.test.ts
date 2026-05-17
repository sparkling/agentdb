// charter: dispatch
// Per-handler unit test for `memory_list` ADR-0181 task #99 commit 2.
//
// Covers:
//   1. Happy path: substrate.list returns N records → N-element RankedResults
//      with offset-inclusive 1-based rank.
//   2. Empty store → empty array.
//   3. Namespace filter is passed through to the substrate. 'all' sentinel
//      drops the filter (substrate called without `namespace`).
//   4. Default limit (50) + default offset (0) when caller omits both.
//   5. Custom limit + offset are forwarded verbatim; rank reflects offset.
//   6. Record mapping: storedAt / updatedAt are ISO strings from unix-millis
//      createdAt / updatedAt; hasEmbedding reflects Float32Array presence;
//      size is content.length.
//   7. STORE_ID is `memory_store`.

import { describe, expect, it } from 'vitest';
import { withTestReadContext } from '../../../../src/archivist/testing/index.js';
import { listMemoryHandler } from '../../../../src/archivist/handlers/memory/list.js';
import type {
  ReadOnlySubstrateAccess,
  StoreId,
  SubstrateAccess,
} from '../../../../src/archivist/types.js';

interface RecordedList {
  readonly storeId: StoreId;
  readonly namespace?: string;
  readonly limit?: number;
  readonly offset?: number;
}

interface FakeRecord {
  readonly key: string;
  readonly namespace: string;
  readonly content: string;
  readonly embedding?: Float32Array;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly accessCount?: number;
  // ADR-0181 task #100 (cli-flip prep) — substrate row may carry tags
  // (`MemoryEntryShape.tags`). The handler now surfaces them on the
  // projected MemoryListRecord.
  readonly tags?: readonly string[];
}

function makeListSubstrateFake(records: FakeRecord[] = []): {
  access: SubstrateAccess;
  state: { readonly calls: RecordedList[] };
} {
  const calls: RecordedList[] = [];
  const handle = {
    async read(): Promise<unknown> {
      throw new Error('list fake: read should not be called');
    },
    async write(): Promise<void> { throw new Error('list fake: write should not be called'); },
    async withWrite(): Promise<void> { throw new Error('list fake: withWrite should not be called'); },
    async withBulkWrite(): Promise<void> { throw new Error('list fake: withBulkWrite should not be called'); },
    async query(): Promise<readonly unknown[]> { return []; },
    async vectorSearch(): Promise<ReadonlyArray<{ item: unknown; score: number }>> { return []; },
    async getByKey(): Promise<unknown | undefined> { return undefined; },
    async list<R>(scope: {
      storeId: StoreId;
      namespace?: string;
      limit?: number;
      offset?: number;
    }): Promise<ReadonlyArray<R>> {
      calls.push({
        storeId: scope.storeId,
        namespace: scope.namespace,
        limit: scope.limit,
        offset: scope.offset,
      });
      let rows = records.slice();
      if (scope.namespace !== undefined) rows = rows.filter((r) => r.namespace === scope.namespace);
      const offset = scope.offset ?? 0;
      const limit = scope.limit ?? rows.length;
      return rows.slice(offset, offset + limit) as unknown as ReadonlyArray<R>;
    },
  };
  return {
    access: handle as unknown as SubstrateAccess,
    state: { calls },
  };
}

describe('memory_list handler (ADR-0181 task #99 commit 2)', () => {
  it('returns RankedResults for each record with 1-based rank', async () => {
    const fake = makeListSubstrateFake([
      { key: 'k1', namespace: 'n', content: 'aaa' },
      { key: 'k2', namespace: 'n', content: 'bbb' },
    ]);
    const { result } = await withTestReadContext(listMemoryHandler, {
      namespace: 'n',
    }, { substrate: fake.access });
    expect(result).toHaveLength(2);
    expect(result[0].provenance.rank).toBe(1);
    expect(result[1].provenance.rank).toBe(2);
    expect(result[0].item.key).toBe('k1');
    expect(result[0].score).toBe(0);
    expect(result[0].provenance).toMatchObject({
      storeId: 'memory_store',
      matchType: 'exact',
      rawScore: 0,
    });
  });

  it('returns empty array when substrate has no records', async () => {
    const fake = makeListSubstrateFake([]);
    const { result } = await withTestReadContext(listMemoryHandler, {
      namespace: 'n',
    }, { substrate: fake.access });
    expect(result).toEqual([]);
  });

  it('passes namespace filter through to substrate', async () => {
    const fake = makeListSubstrateFake();
    await withTestReadContext(listMemoryHandler, {
      namespace: 'tenant-a',
    }, { substrate: fake.access });
    expect(fake.state.calls).toEqual([
      { storeId: 'memory_store', namespace: 'tenant-a', limit: 50, offset: 0 },
    ]);
  });

  it('drops namespace filter for the "all" sentinel', async () => {
    const fake = makeListSubstrateFake();
    await withTestReadContext(listMemoryHandler, {
      namespace: 'all',
    }, { substrate: fake.access });
    expect(fake.state.calls).toEqual([
      { storeId: 'memory_store', namespace: undefined, limit: 50, offset: 0 },
    ]);
  });

  it('defaults limit to 50 and offset to 0 when omitted', async () => {
    const fake = makeListSubstrateFake();
    await withTestReadContext(listMemoryHandler, {}, { substrate: fake.access });
    expect(fake.state.calls).toEqual([
      { storeId: 'memory_store', namespace: undefined, limit: 50, offset: 0 },
    ]);
  });

  it('forwards explicit limit + offset; rank reflects offset', async () => {
    const fake = makeListSubstrateFake([
      { key: 'k1', namespace: 'n', content: 'a' },
      { key: 'k2', namespace: 'n', content: 'b' },
      { key: 'k3', namespace: 'n', content: 'c' },
    ]);
    const { result } = await withTestReadContext(listMemoryHandler, {
      namespace: 'n',
      limit: 2,
      offset: 1,
    }, { substrate: fake.access });
    expect(fake.state.calls).toEqual([
      { storeId: 'memory_store', namespace: 'n', limit: 2, offset: 1 },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].provenance.rank).toBe(2); // offset + 0 + 1
    expect(result[1].provenance.rank).toBe(3); // offset + 1 + 1
    expect(result[0].item.key).toBe('k2');
    expect(result[1].item.key).toBe('k3');
  });

  it('maps record fields to MemoryListRecord envelope', async () => {
    const created = Date.UTC(2026, 0, 1, 12, 0, 0); // 2026-01-01T12:00:00Z
    const updated = Date.UTC(2026, 0, 2, 12, 0, 0);
    const embedding = new Float32Array([0.1, 0.2, 0.3]);
    const fake = makeListSubstrateFake([
      {
        key: 'k1',
        namespace: 'n',
        content: 'hello world',
        embedding,
        createdAt: created,
        updatedAt: updated,
        accessCount: 7,
      },
    ]);
    const { result } = await withTestReadContext(listMemoryHandler, {
      namespace: 'n',
    }, { substrate: fake.access });
    expect(result).toHaveLength(1);
    // ADR-0181 task #100 (cli-flip prep) — the envelope now surfaces
    // `content` (raw) + `tags` so `session_save → session_restore` round-
    // trips with real values (session-tools.ts:227 reads `entry.content`)
    // and cli callers iterating `entry.tags` never NPE. `tags` defaults to
    // [] when the substrate row carries no tags field.
    expect(result[0].item).toEqual({
      key: 'k1',
      namespace: 'n',
      storedAt: new Date(created).toISOString(),
      updatedAt: new Date(updated).toISOString(),
      accessCount: 7,
      hasEmbedding: true,
      size: 'hello world'.length,
      content: 'hello world',
      tags: [],
    });
  });

  it('targets STORE_ID memory_store', async () => {
    const fake = makeListSubstrateFake();
    await withTestReadContext(listMemoryHandler, {}, { substrate: fake.access });
    expect(fake.state.calls[0].storeId).toBe('memory_store');
  });

  // ─── ADR-0181 task #100 (cli-flip prep) — widened MemoryListRecord ───
  //
  // The cli's pre-flip envelope dropped `content` and `tags` from
  // `routeMemoryOp({type:'list'})` results. session_save reads
  // `entry.content || entry.value` (session-tools.ts:227-228), so dropping
  // content caused `session_save → session_restore` to round-trip empty
  // values. The handler now surfaces both fields on every list row.
  describe('widened MemoryListRecord shape (cli-flip prep)', () => {
    it('surfaces raw content on each list row (session_save round-trip)', async () => {
      const fake = makeListSubstrateFake([
        { key: 'k1', namespace: 'n', content: 'first value' },
        { key: 'k2', namespace: 'n', content: 'second value' },
      ]);
      const { result } = await withTestReadContext(listMemoryHandler, {
        namespace: 'n',
      }, { substrate: fake.access });
      expect(result).toHaveLength(2);
      expect(result[0].item.content).toBe('first value');
      expect(result[1].item.content).toBe('second value');
    });

    it('content defaults to empty string (not undefined) so the envelope shape is uniform', async () => {
      // FakeRecord.content is required for the test fixture, but production
      // entries could in principle carry an empty content. The handler
      // surfaces '' rather than omitting the field so cli readers get a
      // stable shape.
      const fake = makeListSubstrateFake([
        { key: 'k', namespace: 'n', content: '' },
      ]);
      const { result } = await withTestReadContext(listMemoryHandler, {
        namespace: 'n',
      }, { substrate: fake.access });
      expect(result[0].item.content).toBe('');
    });

    it('surfaces tags when the substrate row carries them; defaults to [] otherwise', async () => {
      const fake = makeListSubstrateFake([
        { key: 'k1', namespace: 'n', content: 'a', tags: ['t1', 't2'] },
        { key: 'k2', namespace: 'n', content: 'b' }, // no tags field
      ]);
      const { result } = await withTestReadContext(listMemoryHandler, {
        namespace: 'n',
      }, { substrate: fake.access });
      expect(result).toHaveLength(2);
      expect(result[0].item.tags).toEqual(['t1', 't2']);
      // Default [] — cli callers iterating entry.tags never NPE.
      expect(result[1].item.tags).toEqual([]);
    });
  });
});
