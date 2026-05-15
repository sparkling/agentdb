// charter: dispatch
// Per-handler unit test for `agentdb_hierarchical_recall` (ADR-0181 Phase 4 W3).
//
// Covers the two layers the un-stub wires:
//   1. `ctx.capabilities.requireEmbeddingScorer().embed(query)` produces the
//      query vector handed to `ctx.substrate.vectorSearch`.
//   2. `ctx.substrate.vectorSearch({ storeId: 'agentdb_hierarchical_store', ... })`
//      returns ranked hits; the handler projects each hit's metadata onto a
//      `HierarchicalRecallHit` and synthesizes per-hit `RankedResult` provenance.
//
// Plus the fail-loud contract: an unwired `EmbeddingScorer` throws at the
// capability accessor — same shape as production behaves for an un-supplied
// factory in `ArchivistInitConfig`.

import { describe, it, expect } from 'vitest';
import { withTestReadContext } from '../../../../src/archivist/testing/index.js';
import { hierarchicalRecallHandler } from '../../../../src/archivist/handlers/agentdb/hierarchical-recall.js';
import type { EmbeddingScorer } from '../../../../src/archivist/capabilities.js';
import type { StoreId, SubstrateAccess, SubstrateHandle } from '../../../../src/archivist/types.js';

interface FakeHit {
  readonly id: string;
  readonly similarity: number;
  readonly metadata: Record<string, unknown>;
}

interface VectorSearchCall {
  readonly storeId: StoreId;
  readonly vector: Float32Array;
  readonly topK: number;
}

function makeRvfReadFake(hits: ReadonlyArray<FakeHit>): {
  access: SubstrateAccess;
  calls: ReadonlyArray<VectorSearchCall>;
} {
  const calls: VectorSearchCall[] = [];
  const handle: SubstrateHandle & {
    vectorSearch: (scope: { storeId: StoreId; vector: Float32Array; topK: number }) => Promise<
      ReadonlyArray<{ item: unknown; score: number }>
    >;
    query: (scope: { storeId: StoreId; predicate: unknown }) => Promise<ReadonlyArray<unknown>>;
  } = {
    async read<R>(): Promise<R | undefined> {
      throw new Error('rvf read fake: handle.read is not supported');
    },
    async write(): Promise<void> {
      throw new Error('rvf read fake: handle.write is not supported');
    },
    async withWrite<T>(
      _scope: { storeId: StoreId },
      fn: (h: SubstrateHandle) => Promise<T>,
    ): Promise<T> {
      return fn(handle);
    },
    async withBulkWrite(): Promise<void> {
      throw new Error('rvf read fake: handle.withBulkWrite is not supported');
    },
    async query(): Promise<ReadonlyArray<unknown>> {
      throw new Error('rvf read fake: handle.query is not supported');
    },
    async vectorSearch(scope) {
      calls.push({ storeId: scope.storeId, vector: scope.vector, topK: scope.topK });
      return hits.map((h) => ({ item: h, score: h.similarity }));
    },
  };
  return { access: handle as unknown as SubstrateAccess, calls };
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
    get embedCalls() {
      return embedCalls;
    },
  };
}

describe('agentdb_hierarchical_recall handler (ADR-0181 Phase 4 W3)', () => {
  it('embeds the query, vector-searches agentdb_hierarchical_store, and projects ranked hits', async () => {
    const queryVector = new Float32Array([0.1, 0.2, 0.3]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    const { access, calls } = makeRvfReadFake([
      {
        id: 'hier-1',
        similarity: 0.91,
        metadata: { tier: 'semantic', key: 'plan/a', value: 'recall plan A' },
      },
      {
        id: 'hier-2',
        similarity: 0.74,
        metadata: { tier: 'episodic', key: 'evt/2', value: { detail: 42 } },
      },
    ]);

    const { result } = await withTestReadContext(
      hierarchicalRecallHandler,
      { query: 'recall the plans', topK: 5 },
      { substrate: access, embeddingScorer: scorer },
    );

    expect(scorer.embedCalls).toEqual(['recall the plans']);
    expect(calls).toEqual([
      { storeId: 'agentdb_hierarchical_store', vector: queryVector, topK: 5 },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      item: { key: 'plan/a', value: 'recall plan A', tier: 'semantic', score: 0.91 },
      score: 0.91,
      provenance: {
        storeId: 'hierarchical:semantic',
        matchType: 'semantic',
        rawScore: 0.91,
        rank: 1,
        matchedField: 'query',
      },
    });
    expect(result[1].item).toEqual({
      key: 'evt/2',
      value: { detail: 42 },
      tier: 'episodic',
      score: 0.74,
    });
    expect(result[1].provenance.rank).toBe(2);
    expect(result[1].provenance.storeId).toBe('hierarchical:episodic');
  });

  it('filters by tier client-side and re-ranks remaining hits with sequential ranks', async () => {
    const scorer = makeEmbeddingScorerStub(new Float32Array([1, 0]));
    const { access, calls } = makeRvfReadFake([
      { id: 'w1', similarity: 0.95, metadata: { tier: 'working', key: 'w1', value: 'w' } },
      { id: 's1', similarity: 0.85, metadata: { tier: 'semantic', key: 's1', value: 's' } },
      { id: 'e1', similarity: 0.80, metadata: { tier: 'episodic', key: 'e1', value: 'e' } },
      { id: 's2', similarity: 0.70, metadata: { tier: 'semantic', key: 's2', value: 's2' } },
    ]);

    const { result } = await withTestReadContext(
      hierarchicalRecallHandler,
      { query: 'q', tier: 'semantic', topK: 5 },
      { substrate: access, embeddingScorer: scorer },
    );

    // Tier filter over-fetches via topK * 4 — assert the substrate call honoured it.
    expect(calls[0].topK).toBe(20);
    expect(result.map((r) => r.item.key)).toEqual(['s1', 's2']);
    expect(result.map((r) => r.provenance.rank)).toEqual([1, 2]);
    expect(result.every((r) => r.item.tier === 'semantic')).toBe(true);
  });

  it('falls back to metadata.content when value is absent and uses substrate id when key is missing', async () => {
    const scorer = makeEmbeddingScorerStub(new Float32Array([1]));
    const { access } = makeRvfReadFake([
      {
        id: 'hier-only-content',
        similarity: 0.5,
        metadata: { tier: 'working', content: 'inline payload' },
      },
    ]);

    const { result } = await withTestReadContext(
      hierarchicalRecallHandler,
      { query: 'q' },
      { substrate: access, embeddingScorer: scorer },
    );

    expect(result).toHaveLength(1);
    expect(result[0].item).toEqual({
      key: 'hier-only-content',
      value: 'inline payload',
      tier: 'working',
      score: 0.5,
    });
  });

  it('skips hits whose tier metadata is missing or invalid (no silent passthrough)', async () => {
    const scorer = makeEmbeddingScorerStub(new Float32Array([1]));
    const { access } = makeRvfReadFake([
      { id: 'no-tier', similarity: 0.9, metadata: { key: 'x', value: 'x' } },
      { id: 'bad-tier', similarity: 0.8, metadata: { tier: 'archived', key: 'y', value: 'y' } },
      { id: 'ok', similarity: 0.7, metadata: { tier: 'episodic', key: 'z', value: 'z' } },
    ]);

    const { result } = await withTestReadContext(
      hierarchicalRecallHandler,
      { query: 'q' },
      { substrate: access, embeddingScorer: scorer },
    );

    expect(result).toHaveLength(1);
    expect(result[0].item.key).toBe('z');
    expect(result[0].provenance.rank).toBe(1);
  });

  it('caps the response at topK after tier filtering', async () => {
    const scorer = makeEmbeddingScorerStub(new Float32Array([1]));
    const { access } = makeRvfReadFake(
      Array.from({ length: 8 }, (_, i) => ({
        id: `s${i}`,
        similarity: 1 - i * 0.05,
        metadata: { tier: 'semantic' as const, key: `s${i}`, value: i },
      })),
    );

    const { result } = await withTestReadContext(
      hierarchicalRecallHandler,
      { query: 'q', topK: 3 },
      { substrate: access, embeddingScorer: scorer },
    );

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.item.key)).toEqual(['s0', 's1', 's2']);
  });

  it('throws fail-loud when the EmbeddingScorer capability is unwired', async () => {
    const { access } = makeRvfReadFake([]);

    await expect(
      withTestReadContext(
        hierarchicalRecallHandler,
        { query: 'unembedded' },
        { substrate: access },
      ),
    ).rejects.toThrow(/EmbeddingScorer capability/i);
  });

  it('returns empty array when the substrate has no hits (no synthetic fallbacks)', async () => {
    const scorer = makeEmbeddingScorerStub(new Float32Array([1]));
    const { access } = makeRvfReadFake([]);

    const { result } = await withTestReadContext(
      hierarchicalRecallHandler,
      { query: 'no matches' },
      { substrate: access, embeddingScorer: scorer },
    );

    expect(result).toEqual([]);
  });
});
