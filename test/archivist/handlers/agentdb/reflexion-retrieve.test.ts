// charter: dispatch
// Per-handler unit test for `agentdb_reflexion_retrieve` (ADR-0181 Phase 4 W4).
//
// Covers the SQLite carve-out read that:
//   (a) embeds the query task via the narrow `EmbeddingScorer` capability;
//   (b) queries the `episodes` JOIN `episode_embeddings` carve-out tables via
//       `ctx.substrate.query` with the cli's `onlyFailures` / `onlySuccesses`
//       / `minReward` filter knobs pushed down to the SQL WHERE clause;
//   (c) computes fresh cosine similarity against each candidate embedding;
//   (d) ranks top-k and emits `RankedResults<ReflexionEpisodeHit>` provenance.
//
// Plus fail-loud behaviour: unwired EmbeddingScorer throws; malformed
// embedding BLOB byteLength throws; malformed metadata JSON throws.

import { describe, it, expect } from 'vitest';
import { withTestReadContext } from '../../../../src/archivist/testing/index.js';
import { reflexionRetrieveHandler } from '../../../../src/archivist/handlers/agentdb/reflexion-retrieve.js';
import type { EmbeddingScorer } from '../../../../src/archivist/capabilities.js';
import type { StoreId, SubstrateAccess, SubstrateHandle } from '../../../../src/archivist/types.js';

interface EpisodeRow {
  readonly id: number;
  readonly task: string;
  readonly input: string | null;
  readonly output: string | null;
  readonly critique: string | null;
  readonly reward: number;
  readonly success: number;
  readonly metadata: string | null;
  readonly embedding: Buffer;
}

interface QueryCall {
  readonly storeId: StoreId;
  readonly predicate: unknown;
}

function makeSqliteReadFake(rows: ReadonlyArray<EpisodeRow>): {
  access: SubstrateAccess;
  calls: ReadonlyArray<QueryCall>;
} {
  const calls: QueryCall[] = [];
  const handle: SubstrateHandle & {
    query: (scope: { storeId: StoreId; predicate: unknown }) => Promise<ReadonlyArray<unknown>>;
    vectorSearch: (scope: { storeId: StoreId; vector: Float32Array; topK: number }) => Promise<
      ReadonlyArray<{ item: unknown; score: number }>
    >;
  } = {
    async read<R>(): Promise<R | undefined> {
      throw new Error('sqlite read fake: handle.read is not supported');
    },
    async write(): Promise<void> {
      throw new Error('sqlite read fake: handle.write is not supported');
    },
    async withWrite<T>(_scope: { storeId: StoreId }, fn: (h: SubstrateHandle) => Promise<T>): Promise<T> {
      return fn(handle);
    },
    async withBulkWrite(): Promise<void> {
      throw new Error('sqlite read fake: handle.withBulkWrite is not supported');
    },
    async query(scope) {
      calls.push({ storeId: scope.storeId, predicate: scope.predicate });
      return rows;
    },
    async vectorSearch(): Promise<ReadonlyArray<{ item: unknown; score: number }>> {
      throw new Error('sqlite read fake: handle.vectorSearch is not supported');
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

/** Serialize a Float32Array into the BLOB shape the reflexion-store path persists. */
function blobOf(values: ReadonlyArray<number>): Buffer {
  const arr = new Float32Array(values);
  return Buffer.from(arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength));
}

describe('agentdb_reflexion_retrieve handler (ADR-0181 Phase 4 W4)', () => {
  it('embeds the query, queries episodes JOIN episode_embeddings, and ranks by fresh cosine', async () => {
    // queryVector aligned with the second row's embedding ⇒ highest similarity
    const queryVector = new Float32Array([0, 1, 0]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    const { access, calls } = makeSqliteReadFake([
      {
        id: 1,
        task: 'fix-bug-a',
        input: JSON.stringify({ a: 1 }),
        output: JSON.stringify({ ok: true }),
        critique: 'good',
        reward: 0.9,
        success: 1,
        metadata: JSON.stringify({ tag: 'fix' }),
        embedding: blobOf([1, 0, 0]),
      },
      {
        id: 2,
        task: 'fix-bug-b',
        input: null,
        output: null,
        critique: null,
        reward: 0.8,
        success: 1,
        metadata: null,
        embedding: blobOf([0, 1, 0]),
      },
    ]);

    const { result } = await withTestReadContext(
      reflexionRetrieveHandler,
      { task: 'find similar bug fix', k: 5 },
      { substrate: access, embeddingScorer: scorer },
    );

    expect(scorer.embedCalls).toEqual(['find similar bug fix']);
    expect(calls).toHaveLength(1);
    expect(calls[0].storeId).toBe('agentdb_reflexion_retrieve');
    const pred = calls[0].predicate as { sql: string; params: Record<string, unknown> };
    expect(pred.sql).toMatch(/FROM episodes e/);
    expect(pred.sql).toMatch(/INNER JOIN episode_embeddings ee/);

    expect(result).toHaveLength(2);
    expect(result[0].item.id).toBe(2);
    expect(result[0].item.similarity).toBeCloseTo(1, 5);
    expect(result[0].score).toBeCloseTo(1, 5);
    expect(result[0].provenance).toEqual({
      storeId: 'reflexion',
      matchType: 'semantic',
      rawScore: result[0].score,
      rank: 1,
      matchedField: 'task',
    });

    expect(result[1].item.id).toBe(1);
    expect(result[1].item.similarity).toBeCloseTo(0, 5);
    expect(result[1].item.input).toEqual({ a: 1 });
    expect(result[1].item.output).toEqual({ ok: true });
    expect(result[1].item.metadata).toEqual({ tag: 'fix' });
    expect(result[1].item.success).toBe(true);
    expect(result[1].provenance.rank).toBe(2);
  });

  it('pushes onlyFailures/onlySuccesses/minReward down to the WHERE clause', async () => {
    const scorer = makeEmbeddingScorerStub(new Float32Array([1, 0]));
    const { access, calls } = makeSqliteReadFake([]);

    await withTestReadContext(
      reflexionRetrieveHandler,
      { task: 'q', onlyFailures: true, minReward: 0.5 },
      { substrate: access, embeddingScorer: scorer },
    );

    const pred = calls[0].predicate as { sql: string; params: Record<string, unknown> };
    expect(pred.sql).toMatch(/e\.success = 0/);
    expect(pred.sql).toMatch(/e\.reward >= @minReward/);
    expect(pred.sql).not.toMatch(/e\.success = 1/);
    expect(pred.params).toEqual({ minReward: 0.5 });

    const { access: access2, calls: calls2 } = makeSqliteReadFake([]);
    await withTestReadContext(
      reflexionRetrieveHandler,
      { task: 'q', onlySuccesses: true },
      { substrate: access2, embeddingScorer: scorer },
    );
    const pred2 = calls2[0].predicate as { sql: string; params: Record<string, unknown> };
    expect(pred2.sql).toMatch(/e\.success = 1/);
    expect(pred2.params).toEqual({});
  });

  it('caps the response at k after the cosine rerank', async () => {
    const scorer = makeEmbeddingScorerStub(new Float32Array([1]));
    const { access } = makeSqliteReadFake(
      Array.from({ length: 6 }, (_, i) => ({
        id: i + 1,
        task: `t${i}`,
        input: null,
        output: null,
        critique: null,
        reward: 0.5,
        success: 1,
        metadata: null,
        embedding: blobOf([i / 6]), // strictly decreasing alignment with [1] as i grows
      })),
    );

    const { result } = await withTestReadContext(
      reflexionRetrieveHandler,
      { task: 'q', k: 3 },
      { substrate: access, embeddingScorer: scorer },
    );

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.item.id)).toEqual([6, 5, 4]);
  });

  it('throws fail-loud when the EmbeddingScorer capability is unwired', async () => {
    const { access } = makeSqliteReadFake([]);
    await expect(
      withTestReadContext(reflexionRetrieveHandler, { task: 'q' }, { substrate: access }),
    ).rejects.toThrow(/EmbeddingScorer capability/i);
  });

  it('throws fail-loud on a malformed embedding BLOB byteLength', async () => {
    const scorer = makeEmbeddingScorerStub(new Float32Array([1]));
    const { access } = makeSqliteReadFake([
      {
        id: 7,
        task: 't',
        input: null,
        output: null,
        critique: null,
        reward: 0,
        success: 0,
        metadata: null,
        // 5 bytes — not a multiple of 4
        embedding: Buffer.from([0x00, 0x00, 0x00, 0x00, 0xff]),
      },
    ]);

    await expect(
      withTestReadContext(
        reflexionRetrieveHandler,
        { task: 'q' },
        { substrate: access, embeddingScorer: scorer },
      ),
    ).rejects.toThrow(/byteLength 5/);
  });

  it('throws fail-loud on malformed metadata JSON (must be an object)', async () => {
    const scorer = makeEmbeddingScorerStub(new Float32Array([1]));
    const { access } = makeSqliteReadFake([
      {
        id: 1,
        task: 't',
        input: null,
        output: null,
        critique: null,
        reward: 0,
        success: 1,
        metadata: '"not-an-object"',
        embedding: blobOf([1]),
      },
    ]);

    await expect(
      withTestReadContext(
        reflexionRetrieveHandler,
        { task: 'q' },
        { substrate: access, embeddingScorer: scorer },
      ),
    ).rejects.toThrow(/metadata must JSON-parse to an object/);
  });

  it('returns [] when no episodes survive the filter (no synthetic fallbacks)', async () => {
    const scorer = makeEmbeddingScorerStub(new Float32Array([1]));
    const { access } = makeSqliteReadFake([]);
    const { result } = await withTestReadContext(
      reflexionRetrieveHandler,
      { task: 'q' },
      { substrate: access, embeddingScorer: scorer },
    );
    expect(result).toEqual([]);
  });
});
