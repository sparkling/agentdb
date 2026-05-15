// charter: dispatch
// Per-handler unit test for `agentdb_semantic_route` (ADR-0181 Phase 4 W3).
//
// Covers the two layers the un-stub wires:
//   1. `ctx.capabilities.requireEmbeddingScorer().embed(input)` produces the
//      query vector handed to `ctx.substrate.vectorSearch`.
//   2. `ctx.substrate.vectorSearch({ storeId: 'agentdb_route', ... })` returns
//      ranked trajectory hits; the handler reads each hit's metadata for the
//      `route`/`confidence` pair and synthesizes per-hit RankedResult
//      provenance with `storeId: 'semantic-router'`.
//
// Plus the fail-loud contract: an unwired `EmbeddingScorer` throws at the
// capability accessor — exactly as production behaves for an un-supplied
// factory in `ArchivistInitConfig`.

import { describe, it, expect } from 'vitest';
import { withTestReadContext } from '../../../../src/archivist/testing/index.js';
import { semanticRouteHandler } from '../../../../src/archivist/handlers/agentdb/semantic-route.js';
import type {
  EmbeddingScorer,
  SemanticRouteReader,
} from '../../../../src/archivist/capabilities.js';
import type { StoreId, SubstrateAccess, SubstrateHandle } from '../../../../src/archivist/types.js';

interface FakeHit {
  readonly id: string;
  readonly similarity: number;
  readonly metadata?: Record<string, unknown>;
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

describe('agentdb_semantic_route handler (ADR-0181 Phase 4 W3)', () => {
  it('embeds the input, vector-searches agentdb_route, and projects ranked route hits', async () => {
    const queryVector = new Float32Array([0.5, -0.5, 0.5, -0.5]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    const { access, calls } = makeRvfReadFake([
      {
        id: 'route-1',
        similarity: 0.93,
        metadata: { route: 'memory-search', confidence: 0.93, namespace: 'tenant-a' },
      },
      {
        id: 'route-2',
        similarity: 0.71,
        metadata: { route: 'task-orchestrate', confidence: 0.71 },
      },
    ]);

    const { result } = await withTestReadContext(
      semanticRouteHandler,
      { input: 'find me the latest plan' },
      { substrate: access, embeddingScorer: scorer },
    );

    expect(scorer.embedCalls).toEqual(['find me the latest plan']);
    expect(calls).toEqual([
      { storeId: 'agentdb_route', vector: queryVector, topK: 5 },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      item: {
        route: 'memory-search',
        confidence: 0.93,
        metadata: { namespace: 'tenant-a' },
      },
      score: 0.93,
      provenance: {
        storeId: 'semantic-router',
        matchType: 'semantic',
        rawScore: 0.93,
        rank: 1,
        matchedField: 'input',
      },
    });
    expect(result[1].item).toEqual({
      route: 'task-orchestrate',
      confidence: 0.71,
      // No extra metadata beyond route + confidence — `metadata` is omitted, not `{}`
    });
    expect(result[1].provenance.rank).toBe(2);
  });

  it('honours payload.topK as the substrate fetch size', async () => {
    const scorer = makeEmbeddingScorerStub(new Float32Array([1, 0]));
    const { access, calls } = makeRvfReadFake([]);

    await withTestReadContext(
      semanticRouteHandler,
      { input: 'x', topK: 13 },
      { substrate: access, embeddingScorer: scorer },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].topK).toBe(13);
  });

  it('falls back to substrate id when route metadata is absent and to score for missing confidence', async () => {
    const scorer = makeEmbeddingScorerStub(new Float32Array([1]));
    const { access } = makeRvfReadFake([
      { id: 'unlabeled-route-vec', similarity: 0.42, metadata: undefined },
      { id: 'partial', similarity: 0.31, metadata: { foo: 'bar' } },
    ]);

    const { result } = await withTestReadContext(
      semanticRouteHandler,
      { input: 'q' },
      { substrate: access, embeddingScorer: scorer },
    );

    expect(result).toHaveLength(2);
    expect(result[0].item).toEqual({
      route: 'unlabeled-route-vec',
      confidence: 0.42,
    });
    expect(result[1].item).toEqual({
      route: 'partial',
      confidence: 0.31,
      metadata: { foo: 'bar' },
    });
  });

  it('throws fail-loud when the EmbeddingScorer capability is unwired', async () => {
    const { access } = makeRvfReadFake([]);

    await expect(
      withTestReadContext(
        semanticRouteHandler,
        { input: 'unembedded' },
        { substrate: access },
      ),
    ).rejects.toThrow(/EmbeddingScorer capability/i);
  });

  it('returns empty array when the substrate has no trajectory hits (no synthetic fallbacks)', async () => {
    const scorer = makeEmbeddingScorerStub(new Float32Array([1]));
    const { access } = makeRvfReadFake([]);

    const { result } = await withTestReadContext(
      semanticRouteHandler,
      { input: 'cold start' },
      { substrate: access, embeddingScorer: scorer },
    );

    expect(result).toEqual([]);
  });

  // ── ADR-0181 Item 2 (2026-05-15) — controller-first branch tests ──────────

  describe('SemanticRouteReader controller-first branch', () => {
    function makeStubReader(
      result: { route: string; confidence: number; metadata?: Record<string, unknown> } | null,
    ): SemanticRouteReader & { calls: ReadonlyArray<string> } {
      const calls: string[] = [];
      return {
        async route(input) {
          calls.push(input);
          return result;
        },
        get calls() {
          return calls;
        },
      };
    }

    it('returns a one-element RankedResults when the SemanticRouter returns a route', async () => {
      const reader = makeStubReader({ route: 'b5-probe-auth', confidence: 0.87 });
      const { access } = makeRvfReadFake([]);

      const { result } = await withTestReadContext(
        semanticRouteHandler,
        { input: 'JWT authentication with refresh token rotation' },
        { substrate: access, semanticRouteReader: reader },
      );

      expect(reader.calls).toEqual(['JWT authentication with refresh token rotation']);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        item: { route: 'b5-probe-auth', confidence: 0.87 },
        score: 0.87,
        provenance: {
          storeId: 'semantic-router',
          matchType: 'semantic',
          rawScore: 0.87,
          rank: 1,
          matchedField: 'input',
        },
      });
    });

    it('preserves metadata when the SemanticRouter result carries extras', async () => {
      const reader = makeStubReader({
        route: 'memory-search',
        confidence: 0.63,
        metadata: { namespace: 'tenant-a', tags: ['fast'] },
      });

      const { result } = await withTestReadContext(
        semanticRouteHandler,
        { input: 'find me the latest plan' },
        { semanticRouteReader: reader },
      );

      expect(result).toHaveLength(1);
      expect(result[0].item).toEqual({
        route: 'memory-search',
        confidence: 0.63,
        metadata: { namespace: 'tenant-a', tags: ['fast'] },
      });
    });

    it('returns an empty array when the SemanticRouter returns null (no synthetic substrate fallback)', async () => {
      const reader = makeStubReader(null);
      const { access, calls: substrateCalls } = makeRvfReadFake([
        // Even if we DID hit the substrate, this hit would alter the result —
        // the assertion that result is `[]` proves the substrate path is NOT
        // taken when the controller-first branch is active.
        { id: 'unrelated', similarity: 0.99 },
      ]);

      const { result } = await withTestReadContext(
        semanticRouteHandler,
        { input: 'cold start' },
        { substrate: access, semanticRouteReader: reader },
      );

      expect(result).toEqual([]);
      // The controller-first branch must NOT fall through to vectorSearch
      // when the reader is wired — null is the canonical empty signal, not a
      // trigger for the substrate path.
      expect(substrateCalls).toHaveLength(0);
    });

    it('controller-first branch precedes the substrate vectorSearch path even when an EmbeddingScorer is also wired', async () => {
      const reader = makeStubReader({ route: 'controller-pick', confidence: 0.5 });
      const scorer = makeEmbeddingScorerStub(new Float32Array([1]));
      const { access, calls: substrateCalls } = makeRvfReadFake([
        // A substrate hit for an "unrelated-route" would shadow the
        // controller pick if the substrate path executed. The expectation
        // below proves the controller branch wins.
        { id: 'unrelated-route', similarity: 0.99, metadata: { route: 'substrate-pick', confidence: 0.99 } },
      ]);

      const { result } = await withTestReadContext(
        semanticRouteHandler,
        { input: 'q' },
        {
          substrate: access,
          embeddingScorer: scorer,
          semanticRouteReader: reader,
        },
      );

      expect(result).toHaveLength(1);
      expect(result[0].item.route).toBe('controller-pick');
      expect(substrateCalls).toHaveLength(0);
      // The scorer must NOT be invoked either — the controller branch is
      // pure-controller, no embed cost.
      expect(scorer.embedCalls).toHaveLength(0);
    });
  });
});
