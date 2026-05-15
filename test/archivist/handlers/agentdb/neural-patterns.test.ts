// charter: dispatch
// Per-handler unit test for `agentdb_neural_patterns` (ADR-0181 Phase 4 W3).
//
// Covers the un-stub's two action paths:
//   - `action: 'similar'` reads through `ctx.substrate.vectorSearch` against
//     `agentdb_pattern_store` with the caller-supplied embedding; returns
//     `RankedResults<NeuralPatternHit>` (index/similarity/id) with provenance.
//   - `action: 'stats'` is the ESCAPE-HATCH path: GNNService telemetry has no
//     substrate read, so the handler fails loud rather than silently returning
//     empty telemetry (`feedback-no-fallbacks`).
//
// Plus payload-shape validation: an absent/empty embedding on the `similar`
// action fails loud rather than synthesizing a placeholder vector (the cli
// boundary owns diagnostic shapes; the archivist read path does not).

import { describe, it, expect } from 'vitest';
import { withTestReadContext } from '../../../../src/archivist/testing/index.js';
import { neuralPatternsHandler } from '../../../../src/archivist/handlers/agentdb/neural-patterns.js';
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

describe('agentdb_neural_patterns handler (ADR-0181 Phase 4 W3)', () => {
  describe("action: 'similar'", () => {
    it('vector-searches agentdb_pattern_store with the supplied embedding and projects ranked hits', async () => {
      const { access, calls } = makeRvfReadFake([
        { id: 'pat-a', similarity: 0.97, metadata: { kind: 'success' } },
        { id: 'pat-b', similarity: 0.81, metadata: { kind: 'failure' } },
        { id: 'pat-c', similarity: 0.62 },
      ]);

      const { result } = await withTestReadContext(
        neuralPatternsHandler,
        { action: 'similar', embedding: [0.1, 0.2, 0.3, 0.4], topK: 5 },
        { substrate: access },
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].storeId).toBe('agentdb_pattern_store');
      expect(calls[0].topK).toBe(5);
      // Embedding was converted to a Float32Array — verify values, not identity
      expect(Array.from(calls[0].vector)).toEqual([
        Math.fround(0.1),
        Math.fround(0.2),
        Math.fround(0.3),
        Math.fround(0.4),
      ]);

      expect(result).toEqual([
        {
          item: { index: 0, similarity: 0.97, id: 'pat-a' },
          score: 0.97,
          provenance: { storeId: 'gnnService', matchType: 'semantic', rawScore: 0.97, rank: 1 },
        },
        {
          item: { index: 1, similarity: 0.81, id: 'pat-b' },
          score: 0.81,
          provenance: { storeId: 'gnnService', matchType: 'semantic', rawScore: 0.81, rank: 2 },
        },
        {
          item: { index: 2, similarity: 0.62, id: 'pat-c' },
          score: 0.62,
          provenance: { storeId: 'gnnService', matchType: 'semantic', rawScore: 0.62, rank: 3 },
        },
      ]);
    });

    it('defaults topK to 5 when omitted', async () => {
      const { access, calls } = makeRvfReadFake([]);
      await withTestReadContext(
        neuralPatternsHandler,
        { action: 'similar', embedding: [1, 0, 0] },
        { substrate: access },
      );
      expect(calls[0].topK).toBe(5);
    });

    it('throws fail-loud when embedding is missing', async () => {
      const { access } = makeRvfReadFake([]);
      await expect(
        withTestReadContext(
          neuralPatternsHandler,
          { action: 'similar' },
          { substrate: access },
        ),
      ).rejects.toThrow(/requires a non-empty embedding/i);
    });

    it('throws fail-loud when embedding is empty', async () => {
      const { access } = makeRvfReadFake([]);
      await expect(
        withTestReadContext(
          neuralPatternsHandler,
          { action: 'similar', embedding: [] },
          { substrate: access },
        ),
      ).rejects.toThrow(/non-empty embedding/i);
    });

    it('throws fail-loud when embedding contains non-numbers', async () => {
      const { access } = makeRvfReadFake([]);
      await expect(
        withTestReadContext(
          neuralPatternsHandler,
          // Deliberately wrong shape — exercising the runtime guard.
          { action: 'similar', embedding: [1, 'x' as unknown as number, 3] },
          { substrate: access },
        ),
      ).rejects.toThrow(/must contain only numbers/i);
    });

    it('returns empty array when substrate has no pattern hits', async () => {
      const { access } = makeRvfReadFake([]);
      const { result } = await withTestReadContext(
        neuralPatternsHandler,
        { action: 'similar', embedding: [0.5, 0.5] },
        { substrate: access },
      );
      expect(result).toEqual([]);
    });
  });

  describe("action: 'stats'", () => {
    it('throws fail-loud — stats is GNNService-only, not substrate-backed (escape-hatch)', async () => {
      const { access } = makeRvfReadFake([]);
      await expect(
        withTestReadContext(
          neuralPatternsHandler,
          { action: 'stats' },
          { substrate: access },
        ),
      ).rejects.toThrow(/not substrate-backed/i);
    });

    it("throws fail-loud when action defaults to 'stats' (action omitted)", async () => {
      const { access } = makeRvfReadFake([]);
      await expect(
        withTestReadContext(
          neuralPatternsHandler,
          {},
          { substrate: access },
        ),
      ).rejects.toThrow(/not substrate-backed/i);
    });
  });

  describe('unsupported action', () => {
    it('throws fail-loud on an unknown action discriminant', async () => {
      const { access } = makeRvfReadFake([]);
      await expect(
        withTestReadContext(
          neuralPatternsHandler,
          { action: 'nonsense' as unknown as 'similar' },
          { substrate: access },
        ),
      ).rejects.toThrow(/unsupported action/i);
    });
  });
});
