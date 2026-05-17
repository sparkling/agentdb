// charter: dispatch
// Per-handler unit test for `memory_search_unified` ADR-0181 task #99 commit 2.
//
// Covers:
//   1. Happy path: multi-namespace hits → sorted+deduped RankedResults with
//      per-store rank stamp on provenance.
//   2. Empty hits → empty array.
//   3. Empty query → empty array (no embedding call).
//   4. Dedup by key (first occurrence wins after global sort).
//   5. Per-store rank reflects per-namespace 0-based order BEFORE global sort.
//   6. Threshold drops sub-threshold hits.
//   7. STORE_ID is `memory_store`; provenance.storeId carries the per-record
//      source (namespace).

import { describe, expect, it } from 'vitest';
import { withTestReadContext } from '../../../../src/archivist/testing/index.js';
import { searchUnifiedMemoryHandler } from '../../../../src/archivist/handlers/memory/search-unified.js';
import type { EmbeddingScorer } from '../../../../src/archivist/capabilities.js';
import type {
  StoreId,
  SubstrateAccess,
} from '../../../../src/archivist/types.js';

interface FakeHit {
  readonly id: string;
  readonly score: number;
  readonly metadata: { namespace?: string; key?: string; content?: string };
}

interface RecordedSearch {
  readonly storeId: StoreId;
  readonly topK: number;
}

function makeUnifiedSubstrateFake(hits: FakeHit[] = []): {
  access: SubstrateAccess;
  state: { readonly calls: RecordedSearch[] };
} {
  const calls: RecordedSearch[] = [];
  const handle = {
    async read(): Promise<unknown> { throw new Error('unified fake: read should not be called'); },
    async write(): Promise<void> { throw new Error('unified fake: write should not be called'); },
    async withWrite(): Promise<void> { throw new Error('unified fake: withWrite should not be called'); },
    async withBulkWrite(): Promise<void> { throw new Error('unified fake: withBulkWrite should not be called'); },
    async query(): Promise<readonly unknown[]> { return []; },
    async vectorSearch<R>(scope: {
      storeId: StoreId;
      vector: Float32Array;
      topK: number;
    }): Promise<ReadonlyArray<{ item: R; score: number }>> {
      calls.push({ storeId: scope.storeId, topK: scope.topK });
      return hits.map((h) => ({
        item: { id: h.id, metadata: h.metadata } as unknown as R,
        score: h.score,
      }));
    },
    async getByKey(): Promise<unknown | undefined> { return undefined; },
    async list(): Promise<ReadonlyArray<unknown>> { return []; },
  };
  return {
    access: handle as unknown as SubstrateAccess,
    state: { calls },
  };
}

function makeEmbeddingScorerStub(vector: Float32Array): EmbeddingScorer & {
  readonly embedCalls: ReadonlyArray<string>;
} {
  const embedCalls: string[] = [];
  return {
    async embed(text: string): Promise<Float32Array> {
      embedCalls.push(text);
      return vector;
    },
    cosineSimilarity(a, b): number {
      if (a.length !== b.length) throw new Error('length mismatch');
      let dot = 0;
      for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
      return dot;
    },
    get embedCalls() { return embedCalls; },
  };
}

const queryVector = new Float32Array([0.5, 0.5, 0.0]);

describe('memory_search_unified handler (ADR-0181 task #99 commit 2)', () => {
  it('returns sorted RankedResults with per-store rank stamp', async () => {
    // Two namespaces, two hits each. Per-namespace rank is 0-based on
    // raw-score order BEFORE global sort.
    const fake = makeUnifiedSubstrateFake([
      { id: 'a:k1', score: 0.92, metadata: { namespace: 'a', key: 'k1', content: 'A1' } },
      { id: 'a:k2', score: 0.81, metadata: { namespace: 'a', key: 'k2', content: 'A2' } },
      { id: 'b:k3', score: 0.97, metadata: { namespace: 'b', key: 'k3', content: 'B3' } },
      { id: 'b:k4', score: 0.65, metadata: { namespace: 'b', key: 'k4', content: 'B4' } },
    ]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    const { result } = await withTestReadContext(searchUnifiedMemoryHandler, {
      query: 'cross-store search',
    }, { substrate: fake.access, embeddingScorer: scorer });

    expect(result).toHaveLength(4);
    // Global sort by raw score desc.
    expect(result.map((r) => r.item.id)).toEqual(['b:k3', 'a:k1', 'a:k2', 'b:k4']);
    // Per-namespace rank: a={k1:0, k2:1}, b={k3:0, k4:1}.
    expect(result[0].provenance).toMatchObject({ storeId: 'b', rank: 0 });
    expect(result[1].provenance).toMatchObject({ storeId: 'a', rank: 0 });
    expect(result[2].provenance).toMatchObject({ storeId: 'a', rank: 1 });
    expect(result[3].provenance).toMatchObject({ storeId: 'b', rank: 1 });
    // All semantic provenance, matchedField=content.
    for (const r of result) {
      expect(r.provenance.matchType).toBe('semantic');
      expect(r.provenance.matchedField).toBe('content');
    }
  });

  it('returns empty when substrate has no hits', async () => {
    const fake = makeUnifiedSubstrateFake([]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    const { result } = await withTestReadContext(searchUnifiedMemoryHandler, {
      query: 'anything',
    }, { substrate: fake.access, embeddingScorer: scorer });
    expect(result).toEqual([]);
  });

  it('returns empty for empty query (no embed, no substrate call)', async () => {
    const fake = makeUnifiedSubstrateFake([
      { id: 'a:k1', score: 1, metadata: { namespace: 'a', key: 'k1', content: 'x' } },
    ]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    const { result } = await withTestReadContext(searchUnifiedMemoryHandler, {
      query: '',
    }, { substrate: fake.access, embeddingScorer: scorer });
    expect(result).toEqual([]);
    expect(scorer.embedCalls).toEqual([]);
    expect(fake.state.calls).toEqual([]);
  });

  it('deduplicates by key (first occurrence wins after global sort)', async () => {
    // Both records share key 'k1'; b's record scores higher and wins.
    const fake = makeUnifiedSubstrateFake([
      { id: 'a:k1', score: 0.7, metadata: { namespace: 'a', key: 'k1', content: 'A' } },
      { id: 'b:k1', score: 0.95, metadata: { namespace: 'b', key: 'k1', content: 'B' } },
    ]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    const { result } = await withTestReadContext(searchUnifiedMemoryHandler, {
      query: 'q',
    }, { substrate: fake.access, embeddingScorer: scorer });
    expect(result).toHaveLength(1);
    expect(result[0].item.id).toBe('b:k1');
  });

  it('drops sub-threshold hits before bucketing', async () => {
    const fake = makeUnifiedSubstrateFake([
      { id: 'a:k1', score: 0.9, metadata: { namespace: 'a', key: 'k1', content: 'A' } },
      { id: 'a:k2', score: 0.1, metadata: { namespace: 'a', key: 'k2', content: 'B' } },
    ]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    const { result } = await withTestReadContext(searchUnifiedMemoryHandler, {
      query: 'q',
      threshold: 0.5,
    }, { substrate: fake.access, embeddingScorer: scorer });
    expect(result).toHaveLength(1);
    expect(result[0].item.key).toBe('k1');
  });

  it('honors limit on the global deduped result set', async () => {
    const fake = makeUnifiedSubstrateFake([
      { id: 'a:k1', score: 0.95, metadata: { namespace: 'a', key: 'k1', content: 'A' } },
      { id: 'a:k2', score: 0.9, metadata: { namespace: 'a', key: 'k2', content: 'B' } },
      { id: 'b:k3', score: 0.85, metadata: { namespace: 'b', key: 'k3', content: 'C' } },
    ]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    const { result } = await withTestReadContext(searchUnifiedMemoryHandler, {
      query: 'q',
      limit: 2,
    }, { substrate: fake.access, embeddingScorer: scorer });
    expect(result).toHaveLength(2);
    expect(result[0].item.id).toBe('a:k1');
    expect(result[1].item.id).toBe('a:k2');
  });

  it('targets STORE_ID memory_store', async () => {
    const fake = makeUnifiedSubstrateFake([]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    await withTestReadContext(searchUnifiedMemoryHandler, { query: 'q' }, {
      substrate: fake.access,
      embeddingScorer: scorer,
    });
    expect(fake.state.calls[0].storeId).toBe('memory_store');
  });
});
