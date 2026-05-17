// charter: dispatch
// Per-handler unit test for `memory_search` ADR-0181 task #99 commit 2.
//
// Covers:
//   1. Happy path: substrate.vectorSearch returns hits → RankedResults with
//      provenance + semantic match type.
//   2. Empty store → empty array.
//   3. Empty / missing query text → empty array (no embedding generation).
//   4. EmbeddingScorer capability is invoked once with the query text.
//   5. Threshold filter: hits below threshold are dropped.
//   6. Namespace filter: hits in other namespaces are dropped (post-filter
//      against metadata.namespace).
//   7. Custom limit honored; rank assigned in scan order (1-based).
//   8. STORE_ID is `memory_store`.

import { describe, expect, it } from 'vitest';
import { withTestReadContext } from '../../../../src/archivist/testing/index.js';
import { searchMemoryHandler } from '../../../../src/archivist/handlers/memory/search.js';
import type { EmbeddingScorer } from '../../../../src/archivist/capabilities.js';
import type {
  StoreId,
  SubstrateAccess,
} from '../../../../src/archivist/types.js';

interface RecordedSearch {
  readonly storeId: StoreId;
  readonly vector: Float32Array;
  readonly topK: number;
}

interface FakeHit {
  readonly id: string;
  readonly score: number;
  // ADR-0181 task #100 (cli-flip prep) — `tags` flows through metadata
  // (the adapter's Fix A merges top-level entry.tags into result metadata).
  readonly metadata: {
    namespace?: string;
    key?: string;
    content?: string;
    tags?: readonly string[];
  };
}

function makeSearchSubstrateFake(hits: FakeHit[] = []): {
  access: SubstrateAccess;
  state: { readonly calls: RecordedSearch[] };
} {
  const calls: RecordedSearch[] = [];
  const handle = {
    async read(): Promise<unknown> { throw new Error('search fake: read should not be called'); },
    async write(): Promise<void> { throw new Error('search fake: write should not be called'); },
    async withWrite(): Promise<void> { throw new Error('search fake: withWrite should not be called'); },
    async withBulkWrite(): Promise<void> { throw new Error('search fake: withBulkWrite should not be called'); },
    async query(): Promise<readonly unknown[]> { return []; },
    async vectorSearch<R>(scope: {
      storeId: StoreId;
      vector: Float32Array;
      topK: number;
    }): Promise<ReadonlyArray<{ item: R; score: number }>> {
      calls.push({ storeId: scope.storeId, vector: scope.vector, topK: scope.topK });
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

describe('memory_search handler (ADR-0181 task #99 commit 2)', () => {
  it('returns RankedResults with semantic provenance on hit', async () => {
    const fake = makeSearchSubstrateFake([
      { id: 'n:k1', score: 0.95, metadata: { namespace: 'n', key: 'k1', content: 'hello' } },
      { id: 'n:k2', score: 0.82, metadata: { namespace: 'n', key: 'k2', content: 'world' } },
    ]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    const { result } = await withTestReadContext(searchMemoryHandler, {
      text: 'hello world',
      namespace: 'n',
      threshold: 0.3,
    }, { substrate: fake.access, embeddingScorer: scorer });

    expect(result).toHaveLength(2);
    expect(result[0].item.id).toBe('n:k1');
    expect(result[0].item.content).toBe('hello');
    expect(result[0].score).toBe(0.95);
    expect(result[0].provenance).toMatchObject({
      storeId: 'memory_store',
      matchType: 'semantic',
      rawScore: 0.95,
      rank: 1,
      matchedField: 'content',
    });
    expect(result[1].provenance.rank).toBe(2);
  });

  it('returns empty array when substrate has no hits', async () => {
    const fake = makeSearchSubstrateFake([]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    const { result } = await withTestReadContext(searchMemoryHandler, {
      text: 'anything',
    }, { substrate: fake.access, embeddingScorer: scorer });
    expect(result).toEqual([]);
  });

  it('returns empty array for empty query text (no embedding call)', async () => {
    const fake = makeSearchSubstrateFake([
      { id: 'n:k1', score: 1, metadata: { namespace: 'n', key: 'k1', content: 'x' } },
    ]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    const { result } = await withTestReadContext(searchMemoryHandler, {
      text: '',
    }, { substrate: fake.access, embeddingScorer: scorer });
    expect(result).toEqual([]);
    expect(scorer.embedCalls).toEqual([]);
    expect(fake.state.calls).toEqual([]);
  });

  it('invokes embed() exactly once with the query text', async () => {
    const fake = makeSearchSubstrateFake([]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    await withTestReadContext(searchMemoryHandler, {
      text: 'find the JWT auth handler',
    }, { substrate: fake.access, embeddingScorer: scorer });
    expect(scorer.embedCalls).toEqual(['find the JWT auth handler']);
  });

  it('drops hits below the threshold', async () => {
    const fake = makeSearchSubstrateFake([
      { id: 'n:k1', score: 0.9, metadata: { namespace: 'n', key: 'k1', content: 'a' } },
      { id: 'n:k2', score: 0.2, metadata: { namespace: 'n', key: 'k2', content: 'b' } },
    ]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    const { result } = await withTestReadContext(searchMemoryHandler, {
      text: 'q',
      threshold: 0.5,
    }, { substrate: fake.access, embeddingScorer: scorer });
    expect(result).toHaveLength(1);
    expect(result[0].item.id).toBe('n:k1');
  });

  it('drops hits in other namespaces when scoped', async () => {
    const fake = makeSearchSubstrateFake([
      { id: 'a:k1', score: 0.9, metadata: { namespace: 'a', key: 'k1', content: 'a-content' } },
      { id: 'b:k1', score: 0.95, metadata: { namespace: 'b', key: 'k1', content: 'b-content' } },
    ]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    const { result } = await withTestReadContext(searchMemoryHandler, {
      text: 'q',
      namespace: 'a',
    }, { substrate: fake.access, embeddingScorer: scorer });
    expect(result).toHaveLength(1);
    expect(result[0].item.namespace).toBe('a');
  });

  it('honors custom limit and assigns 1-based rank in scan order', async () => {
    const fake = makeSearchSubstrateFake([
      { id: 'n:a', score: 0.95, metadata: { namespace: 'n', key: 'a', content: 'A' } },
      { id: 'n:b', score: 0.9, metadata: { namespace: 'n', key: 'b', content: 'B' } },
      { id: 'n:c', score: 0.85, metadata: { namespace: 'n', key: 'c', content: 'C' } },
    ]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    const { result } = await withTestReadContext(searchMemoryHandler, {
      text: 'q',
      limit: 2,
    }, { substrate: fake.access, embeddingScorer: scorer });
    expect(result).toHaveLength(2);
    expect(result[0].provenance.rank).toBe(1);
    expect(result[1].provenance.rank).toBe(2);
  });

  it('targets STORE_ID memory_store', async () => {
    const fake = makeSearchSubstrateFake([]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    await withTestReadContext(searchMemoryHandler, { text: 'q' }, {
      substrate: fake.access,
      embeddingScorer: scorer,
    });
    expect(fake.state.calls[0].storeId).toBe('memory_store');
  });

  // ─── ADR-0181 task #100 (cli-flip prep) — widened MemoryRecord ───
  //
  // The shared MemoryRecord type now carries optional tags/accessCount/
  // hasEmbedding so retrieve.ts can populate them. search.ts populates
  // `tags` off the merged metadata (Fix A in memory-rvf-adapter.ts).
  describe('widened MemoryRecord shape (cli-flip prep)', () => {
    it('surfaces tags from merged metadata on each hit', async () => {
      const fake = makeSearchSubstrateFake([
        { id: 'n:k1', score: 0.95, metadata: { namespace: 'n', key: 'k1', content: 'hello', tags: ['greeting'] } },
      ]);
      const scorer = makeEmbeddingScorerStub(queryVector);
      const { result } = await withTestReadContext(searchMemoryHandler, {
        text: 'q',
      }, { substrate: fake.access, embeddingScorer: scorer });
      expect(result).toHaveLength(1);
      expect(result[0].item.tags).toEqual(['greeting']);
    });

    it('defaults tags to [] when the merged metadata lacks the field (no NPE)', async () => {
      const fake = makeSearchSubstrateFake([
        { id: 'n:k1', score: 0.95, metadata: { namespace: 'n', key: 'k1', content: 'hello' } },
      ]);
      const scorer = makeEmbeddingScorerStub(queryVector);
      const { result } = await withTestReadContext(searchMemoryHandler, {
        text: 'q',
      }, { substrate: fake.access, embeddingScorer: scorer });
      expect(result[0].item.tags).toEqual([]);
    });
  });
});
