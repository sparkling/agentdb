// charter: dispatch
// Per-handler unit test for `agentdb_pattern_search` (ADR-0181 Phase 4 W4).
//
// Covers the BM25 + semantic + RRF fusion path that lives behind the narrow
// `PatternReader` capability. The handler asks the capability for hits and
// emits `RankedResults<PatternSearchHit>` with `matchType: 'fused'` provenance.
// Tests:
//   (a) happy path: payload knobs forwarded verbatim, hits projected with
//       per-hit provenance (storeId='reasoning_patterns', matchType='fused');
//   (b) fail-loud on an unwired PatternReader factory;
//   (c) empty result set returns [] (no synthetic fallbacks).

import { describe, it, expect } from 'vitest';
import { withTestReadContext } from '../../../../src/archivist/testing/index.js';
import { patternSearchHandler } from '../../../../src/archivist/handlers/agentdb/pattern-search.js';
import type { PatternHit, PatternReader } from '../../../../src/archivist/capabilities.js';

interface SearchCall {
  readonly query: string;
  readonly topK?: number;
  readonly minConfidence?: number;
}

function makePatternReaderStub(hits: ReadonlyArray<PatternHit>): PatternReader & {
  readonly calls: ReadonlyArray<SearchCall>;
} {
  const calls: SearchCall[] = [];
  return {
    async searchPatterns(q) {
      calls.push({ query: q.query, topK: q.topK, minConfidence: q.minConfidence });
      return hits;
    },
    get calls() {
      return calls;
    },
  };
}

describe('agentdb_pattern_search handler (ADR-0181 Phase 4 W4)', () => {
  it('forwards (query, topK, minConfidence) to PatternReader.searchPatterns and emits fused provenance', async () => {
    const reader = makePatternReaderStub([
      { id: 'p1', content: 'pattern A', score: 0.92 },
      { id: 'p2', content: 'pattern B', score: 0.71 },
    ]);

    const { result } = await withTestReadContext(
      patternSearchHandler,
      { query: 'fix flaky tests', topK: 7, minConfidence: 0.5 },
      { patternReader: reader },
    );

    expect(reader.calls).toEqual([{ query: 'fix flaky tests', topK: 7, minConfidence: 0.5 }]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      item: { id: 'p1', content: 'pattern A', score: 0.92 },
      score: 0.92,
      provenance: {
        storeId: 'reasoning_patterns',
        matchType: 'fused',
        rawScore: 0.92,
        rank: 1,
      },
    });
    expect(result[1].provenance.rank).toBe(2);
    expect(result[1].provenance.matchType).toBe('fused');
  });

  it('throws fail-loud when the PatternReader capability is unwired', async () => {
    await expect(
      withTestReadContext(patternSearchHandler, { query: 'anything' }),
    ).rejects.toThrow(/PatternReader capability/i);
  });

  it('returns [] when the capability has no hits (no synthetic fallbacks)', async () => {
    const reader = makePatternReaderStub([]);

    const { result } = await withTestReadContext(
      patternSearchHandler,
      { query: 'no matches' },
      { patternReader: reader },
    );

    expect(result).toEqual([]);
  });
});
