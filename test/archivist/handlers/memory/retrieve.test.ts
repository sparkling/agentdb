// charter: dispatch
// Per-handler unit test for `memory_retrieve` ADR-0181 task #99 commit 2.
//
// Covers:
//   1. Happy-path hit: substrate.getByKey returns a record → 1-element
//      RankedResults with provenance preserved verbatim.
//   2. Miss: substrate.getByKey returns undefined → empty array.
//   3. Empty / missing key payload → empty array (no synthesized lookup).
//   4. Namespace defaulting: omitted namespace → substrate called with 'default'.
//   5. The 'all' namespace sentinel resolves to 'default' (no broadcast lookup
//      — the substrate's getByKey is single-namespace by contract).
//   6. STORE_ID is `memory_store` (not the obsolete `memory_search_index`).

import { describe, expect, it } from 'vitest';
import { withTestReadContext } from '../../../../src/archivist/testing/index.js';
import { retrieveMemoryHandler } from '../../../../src/archivist/handlers/memory/retrieve.js';
import type {
  ReadOnlySubstrateAccess,
  StoreId,
  SubstrateAccess,
} from '../../../../src/archivist/types.js';

interface RecordedGetByKey {
  readonly storeId: StoreId;
  readonly namespace: string;
  readonly key: string;
}

interface RetrieveFakeOpts {
  readonly hit?: {
    readonly id: string;
    readonly key: string;
    readonly namespace: string;
    readonly content: string;
    readonly metadata?: Record<string, unknown>;
    // ADR-0181 task #100 (cli-flip prep) — substrate-returned entry may
    // carry top-level tags/accessCount/embedding which the handler now
    // surfaces on the projected MemoryRecord.
    readonly tags?: readonly string[];
    readonly accessCount?: number;
    readonly embedding?: Float32Array;
  };
}

function makeRetrieveSubstrateFake(opts: RetrieveFakeOpts = {}): {
  access: SubstrateAccess;
  state: { readonly calls: RecordedGetByKey[] };
} {
  const calls: RecordedGetByKey[] = [];
  const handle = {
    async read(): Promise<unknown> {
      throw new Error('retrieve fake: read should not be called');
    },
    async write(): Promise<void> {
      throw new Error('retrieve fake: write should not be called');
    },
    async withWrite(): Promise<void> {
      throw new Error('retrieve fake: withWrite should not be called');
    },
    async withBulkWrite(): Promise<void> {
      throw new Error('retrieve fake: withBulkWrite should not be called');
    },
    async query(): Promise<readonly unknown[]> {
      return [];
    },
    async vectorSearch(): Promise<ReadonlyArray<{ item: unknown; score: number }>> {
      return [];
    },
    async getByKey<R>(scope: { storeId: StoreId; namespace: string; key: string }): Promise<R | undefined> {
      calls.push({ storeId: scope.storeId, namespace: scope.namespace, key: scope.key });
      if (
        opts.hit &&
        opts.hit.namespace === scope.namespace &&
        opts.hit.key === scope.key
      ) {
        return opts.hit as unknown as R;
      }
      return undefined;
    },
    async list(): Promise<ReadonlyArray<unknown>> {
      return [];
    },
  };
  const access = handle as unknown as ReadOnlySubstrateAccess;
  return { access: access as unknown as SubstrateAccess, state: { calls } };
}

describe('memory_retrieve handler (ADR-0181 task #99 commit 2)', () => {
  it('returns 1-element RankedResults on hit with provenance preserved', async () => {
    const fake = makeRetrieveSubstrateFake({
      hit: {
        id: 'tenant-a:k1',
        key: 'k1',
        namespace: 'tenant-a',
        content: 'hello world',
        metadata: { tags: ['greeting'] },
      },
    });

    const { result } = await withTestReadContext(retrieveMemoryHandler, {
      namespace: 'tenant-a',
      key: 'k1',
    }, { substrate: fake.access });

    expect(result).toHaveLength(1);
    expect(result[0].item).toMatchObject({
      id: 'tenant-a:k1',
      namespace: 'tenant-a',
      key: 'k1',
      content: 'hello world',
      score: 1,
    });
    expect(result[0].score).toBe(1);
    expect(result[0].provenance).toEqual({
      storeId: 'memory_store',
      matchType: 'exact',
      rawScore: 1,
      rank: 1,
    });
  });

  it('returns empty array on miss', async () => {
    const fake = makeRetrieveSubstrateFake();
    const { result } = await withTestReadContext(retrieveMemoryHandler, {
      namespace: 'tenant-a',
      key: 'k1',
    }, { substrate: fake.access });
    expect(result).toEqual([]);
  });

  it('returns empty array when key is missing (no synthesized lookup)', async () => {
    const fake = makeRetrieveSubstrateFake({
      hit: { id: 'x', key: 'k', namespace: 'n', content: 'c' },
    });
    const { result } = await withTestReadContext(retrieveMemoryHandler, {
      namespace: 'n',
    }, { substrate: fake.access });
    expect(result).toEqual([]);
    expect(fake.state.calls).toEqual([]); // substrate not called at all
  });

  it('returns empty array when key is empty string', async () => {
    const fake = makeRetrieveSubstrateFake({
      hit: { id: 'x', key: '', namespace: 'n', content: 'c' },
    });
    const { result } = await withTestReadContext(retrieveMemoryHandler, {
      namespace: 'n',
      key: '',
    }, { substrate: fake.access });
    expect(result).toEqual([]);
    expect(fake.state.calls).toEqual([]);
  });

  it('defaults namespace to "default" when payload.namespace omitted', async () => {
    const fake = makeRetrieveSubstrateFake({
      hit: { id: 'default:k1', key: 'k1', namespace: 'default', content: 'v' },
    });
    const { result } = await withTestReadContext(retrieveMemoryHandler, {
      key: 'k1',
    }, { substrate: fake.access });
    expect(fake.state.calls).toEqual([
      { storeId: 'memory_store', namespace: 'default', key: 'k1' },
    ]);
    expect(result).toHaveLength(1);
  });

  it('resolves the "all" namespace sentinel to "default"', async () => {
    const fake = makeRetrieveSubstrateFake();
    await withTestReadContext(retrieveMemoryHandler, {
      namespace: 'all',
      key: 'k1',
    }, { substrate: fake.access });
    expect(fake.state.calls).toEqual([
      { storeId: 'memory_store', namespace: 'default', key: 'k1' },
    ]);
  });

  it('targets STORE_ID memory_store (not memory_search_index)', async () => {
    const fake = makeRetrieveSubstrateFake();
    await withTestReadContext(retrieveMemoryHandler, {
      namespace: 'n',
      key: 'k',
    }, { substrate: fake.access });
    expect(fake.state.calls[0].storeId).toBe('memory_store');
  });

  // ─── ADR-0181 task #100 (cli-flip prep) — widened MemoryRecord shape ───
  //
  // The cli's pre-flip envelope (cli/src/mcp-tools/memory-tools.ts:405-416)
  // exposes `tags`, `accessCount`, `hasEmbedding` on the retrieve response.
  // Cli callers iterating `entry.tags.length` crash when these fields are
  // dropped. The handler now surfaces them on the projected MemoryRecord:
  //   - tags: copied from entry.tags, defaulting to []
  //   - accessCount: copied from entry.accessCount, defaulting to 0
  //   - hasEmbedding: !!entry.embedding (boolean derived from raw Float32Array)
  describe('widened MemoryRecord shape (cli-flip prep)', () => {
    it('surfaces tags from the substrate entry on the projected MemoryRecord', async () => {
      const fake = makeRetrieveSubstrateFake({
        hit: {
          id: 'n:k',
          key: 'k',
          namespace: 'n',
          content: 'v',
          tags: ['greeting', 'urgent'],
        },
      });
      const { result } = await withTestReadContext(retrieveMemoryHandler, {
        namespace: 'n',
        key: 'k',
      }, { substrate: fake.access });
      expect(result).toHaveLength(1);
      expect(result[0].item.tags).toEqual(['greeting', 'urgent']);
    });

    it('defaults tags to [] when the substrate entry omits the field (no NPE)', async () => {
      const fake = makeRetrieveSubstrateFake({
        hit: { id: 'n:k', key: 'k', namespace: 'n', content: 'v' },
      });
      const { result } = await withTestReadContext(retrieveMemoryHandler, {
        namespace: 'n',
        key: 'k',
      }, { substrate: fake.access });
      expect(result[0].item.tags).toEqual([]);
      // Critical invariant — cli callers do `entry.tags.length`; an
      // undefined tags would throw `Cannot read properties of undefined`.
      expect(result[0].item.tags!.length).toBe(0);
    });

    it('surfaces accessCount when present, defaults to 0 when omitted', async () => {
      const withCount = makeRetrieveSubstrateFake({
        hit: { id: 'n:k', key: 'k', namespace: 'n', content: 'v', accessCount: 42 },
      });
      const r1 = await withTestReadContext(retrieveMemoryHandler, {
        namespace: 'n', key: 'k',
      }, { substrate: withCount.access });
      expect(r1.result[0].item.accessCount).toBe(42);

      const withoutCount = makeRetrieveSubstrateFake({
        hit: { id: 'n:k', key: 'k', namespace: 'n', content: 'v' },
      });
      const r2 = await withTestReadContext(retrieveMemoryHandler, {
        namespace: 'n', key: 'k',
      }, { substrate: withoutCount.access });
      expect(r2.result[0].item.accessCount).toBe(0);
    });

    it('hasEmbedding is true when the substrate entry has an embedding, false otherwise', async () => {
      const withEmbedding = makeRetrieveSubstrateFake({
        hit: {
          id: 'n:k', key: 'k', namespace: 'n', content: 'v',
          embedding: new Float32Array([0.1, 0.2, 0.3]),
        },
      });
      const r1 = await withTestReadContext(retrieveMemoryHandler, {
        namespace: 'n', key: 'k',
      }, { substrate: withEmbedding.access });
      expect(r1.result[0].item.hasEmbedding).toBe(true);

      const withoutEmbedding = makeRetrieveSubstrateFake({
        hit: { id: 'n:k', key: 'k', namespace: 'n', content: 'v' },
      });
      const r2 = await withTestReadContext(retrieveMemoryHandler, {
        namespace: 'n', key: 'k',
      }, { substrate: withoutEmbedding.access });
      expect(r2.result[0].item.hasEmbedding).toBe(false);
    });
  });
});
