// charter: dispatch
// Per-handler unit test for `agentdb_skill_search` (ADR-0181 Phase 4 W4).
//
// Covers the SQLite carve-out read that:
//   (a) embeds the query via the narrow `EmbeddingScorer` capability;
//   (b) queries the `skills` JOIN `skill_embeddings` tables via
//       `ctx.substrate.query` (no metadata pre-filter — the cli's
//       `retrieveSkills` had none);
//   (c) computes fresh cosine similarity per skill embedding;
//   (d) ranks top-`limit` and emits `RankedResults<SkillSearchHit>` provenance.

import { describe, it, expect } from 'vitest';
import { withTestReadContext } from '../../../../src/archivist/testing/index.js';
import { skillSearchHandler } from '../../../../src/archivist/handlers/agentdb/skill-search.js';
import type { EmbeddingScorer } from '../../../../src/archivist/capabilities.js';
import type { StoreId, SubstrateAccess, SubstrateHandle } from '../../../../src/archivist/types.js';

interface SkillRow {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly signature: string | null;
  readonly code: string | null;
  readonly success_rate: number;
  readonly uses: number;
  readonly avg_reward: number;
  readonly avg_latency_ms: number;
  readonly metadata: string | null;
  readonly embedding: Buffer;
}

interface QueryCall {
  readonly storeId: StoreId;
  readonly predicate: unknown;
}

function makeSqliteReadFake(rows: ReadonlyArray<SkillRow>): {
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

function blobOf(values: ReadonlyArray<number>): Buffer {
  const arr = new Float32Array(values);
  return Buffer.from(arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength));
}

describe('agentdb_skill_search handler (ADR-0181 Phase 4 W4)', () => {
  it('embeds the query, joins skills+skill_embeddings, ranks by cosine, and projects rows', async () => {
    const queryVector = new Float32Array([1, 0, 0]);
    const scorer = makeEmbeddingScorerStub(queryVector);
    const { access, calls } = makeSqliteReadFake([
      {
        id: 1,
        name: 'retry-on-flake',
        description: 'retries a flaky step',
        signature: JSON.stringify({ args: ['ctx'] }),
        code: 'function retry(ctx){}',
        success_rate: 0.92,
        uses: 8,
        avg_reward: 0.83,
        avg_latency_ms: 120,
        metadata: JSON.stringify({ tags: ['retry'] }),
        embedding: blobOf([1, 0, 0]),
      },
      {
        id: 2,
        name: 'silent-skill',
        description: null,
        signature: null,
        code: null,
        success_rate: 0.5,
        uses: 1,
        avg_reward: 0.3,
        avg_latency_ms: 90,
        metadata: null,
        embedding: blobOf([0, 1, 0]),
      },
    ]);

    const { result } = await withTestReadContext(
      skillSearchHandler,
      { query: 'flaky retry', limit: 5 },
      { substrate: access, embeddingScorer: scorer },
    );

    expect(scorer.embedCalls).toEqual(['flaky retry']);
    expect(calls).toHaveLength(1);
    expect(calls[0].storeId).toBe('agentdb_skill_search');
    const pred = calls[0].predicate as { sql: string };
    expect(pred.sql).toMatch(/FROM skills s/);
    expect(pred.sql).toMatch(/INNER JOIN skill_embeddings se/);

    expect(result).toHaveLength(2);
    expect(result[0].item).toEqual({
      id: 1,
      name: 'retry-on-flake',
      description: 'retries a flaky step',
      successRate: 0.92,
      uses: 8,
      avgReward: 0.83,
      avgLatencyMs: 120,
      code: 'function retry(ctx){}',
      signature: { args: ['ctx'] },
      metadata: { tags: ['retry'] },
      similarity: result[0].item.similarity,
    });
    expect(result[0].item.similarity).toBeCloseTo(1, 5);
    expect(result[0].provenance).toEqual({
      storeId: 'skills',
      matchType: 'semantic',
      rawScore: result[0].score,
      rank: 1,
      matchedField: 'name',
    });

    // NULL description ⇒ '', NULL code ⇒ undefined, NULL signature ⇒ undefined,
    // NULL metadata ⇒ undefined.
    expect(result[1].item.description).toBe('');
    expect(result[1].item.code).toBeUndefined();
    expect(result[1].item.signature).toBeUndefined();
    expect(result[1].item.metadata).toBeUndefined();
    expect(result[1].provenance.rank).toBe(2);
  });

  it('caps the response at limit after the cosine rerank (default 5)', async () => {
    const scorer = makeEmbeddingScorerStub(new Float32Array([1]));
    const rows = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      name: `s${i}`,
      description: null,
      signature: null,
      code: null,
      success_rate: 0,
      uses: 0,
      avg_reward: 0,
      avg_latency_ms: 0,
      metadata: null,
      embedding: blobOf([(8 - i) / 8]),
    }));
    const { access } = makeSqliteReadFake(rows);

    const { result } = await withTestReadContext(
      skillSearchHandler,
      { query: 'q' },
      { substrate: access, embeddingScorer: scorer },
    );

    expect(result).toHaveLength(5);
    expect(result.map((r) => r.item.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('throws fail-loud when the EmbeddingScorer capability is unwired', async () => {
    const { access } = makeSqliteReadFake([]);
    await expect(
      withTestReadContext(skillSearchHandler, { query: 'q' }, { substrate: access }),
    ).rejects.toThrow(/EmbeddingScorer capability/i);
  });

  it('throws fail-loud on a malformed embedding BLOB byteLength', async () => {
    const scorer = makeEmbeddingScorerStub(new Float32Array([1]));
    const { access } = makeSqliteReadFake([
      {
        id: 7,
        name: 'bad',
        description: 'bad',
        signature: null,
        code: null,
        success_rate: 0,
        uses: 0,
        avg_reward: 0,
        avg_latency_ms: 0,
        metadata: null,
        embedding: Buffer.from([0x00, 0x00, 0x00]), // 3 bytes
      },
    ]);

    await expect(
      withTestReadContext(skillSearchHandler, { query: 'q' }, { substrate: access, embeddingScorer: scorer }),
    ).rejects.toThrow(/byteLength 3/);
  });

  it('returns [] when the substrate has no rows (no synthetic fallbacks)', async () => {
    const scorer = makeEmbeddingScorerStub(new Float32Array([1]));
    const { access } = makeSqliteReadFake([]);
    const { result } = await withTestReadContext(
      skillSearchHandler,
      { query: 'q' },
      { substrate: access, embeddingScorer: scorer },
    );
    expect(result).toEqual([]);
  });
});
