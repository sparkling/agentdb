// charter: dispatch
// Per-handler unit test for `agentdb_embed` (ADR-0181 Phase 4 W4).
//
// `agentdb_embed` is the pure-capability read in the W4 slice — it owns no
// substrate predicate of its own; the narrow `EmbeddingScorer` capability
// produces the vector and the handler shapes the response. Tests cover:
//   (a) happy path: capability is invoked with the input text and the returned
//       Float32Array is projected into `{ success, embedding, dimension }`;
//   (b) fail-loud on an unwired EmbeddingScorer factory;
//   (c) fail-loud on a zero-length vector (capability degraded silently).

import { describe, it, expect } from 'vitest';
import { withTestReadContext } from '../../../../src/archivist/testing/index.js';
import { embedHandler } from '../../../../src/archivist/handlers/agentdb/embed.js';
import type { EmbeddingScorer } from '../../../../src/archivist/capabilities.js';

function makeScorerStub(vector: Float32Array): EmbeddingScorer & { readonly embedCalls: ReadonlyArray<string> } {
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

describe('agentdb_embed handler (ADR-0181 Phase 4 W4)', () => {
  it('invokes EmbeddingScorer.embed and projects the vector into the result envelope', async () => {
    const vector = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const scorer = makeScorerStub(vector);

    const { result } = await withTestReadContext(
      embedHandler,
      { text: 'embed me' },
      { embeddingScorer: scorer },
    );

    expect(scorer.embedCalls).toEqual(['embed me']);
    expect(result.success).toBe(true);
    expect(result.dimension).toBe(4);
    expect(Array.from(result.embedding)).toEqual([
      0.1, 0.2, 0.3, 0.4,
    ].map((v) => Math.fround(v)));
  });

  it('throws fail-loud when the EmbeddingScorer capability is unwired', async () => {
    await expect(
      withTestReadContext(embedHandler, { text: 'unembedded' }),
    ).rejects.toThrow(/EmbeddingScorer capability/i);
  });

  it('throws fail-loud when the embedding service returns an empty vector', async () => {
    const scorer = makeScorerStub(new Float32Array(0));

    await expect(
      withTestReadContext(embedHandler, { text: 'x' }, { embeddingScorer: scorer }),
    ).rejects.toThrow(/empty vector/i);
  });
});
