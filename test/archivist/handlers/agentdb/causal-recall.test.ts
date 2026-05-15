// charter: dispatch
// Per-handler unit test for `agentdb_causal_recall` (ADR-0181 Phase 4 W4).
//
// `agentdb_causal_recall` is the SQLite carve-out read that ranks causal edges
// by uplift. Tests:
//   (a) happy path — substrate.query receives a parameterized SELECT with the
//       confidence/limit/likeQuery params; rows project into hits ranked by
//       uplift with `{ storeId: 'causal_edges', matchType: 'semantic',
//       rawScore: uplift, rank }` provenance;
//   (b) the `includeEvidence` flag round-trips evidence_ids JSON to the hit;
//   (c) the `minConfidence` knob defaults to 0.6 when omitted;
//   (d) unknown memory types fail loud (schema invariant);
//   (e) empty result set returns [].

import { describe, it, expect } from 'vitest';
import { withTestReadContext } from '../../../../src/archivist/testing/index.js';
import { causalRecallHandler } from '../../../../src/archivist/handlers/agentdb/causal-recall.js';
import type { StoreId, SubstrateAccess, SubstrateHandle } from '../../../../src/archivist/types.js';

interface CausalRow {
  readonly id: number;
  readonly from_memory_id: number;
  readonly from_memory_type: string;
  readonly to_memory_id: number;
  readonly to_memory_type: string;
  readonly similarity: number;
  readonly uplift: number;
  readonly confidence: number;
  readonly sample_size: number;
  readonly evidence_ids: string | null;
  readonly mechanism: string | null;
}

interface QueryCall {
  readonly storeId: StoreId;
  readonly predicate: unknown;
}

function makeSqliteReadFake(rows: ReadonlyArray<CausalRow>): {
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

describe('agentdb_causal_recall handler (ADR-0181 Phase 4 W4)', () => {
  it('queries causal_edges with the parameterized SELECT and projects rows to ranked hits', async () => {
    const { access, calls } = makeSqliteReadFake([
      {
        id: 10,
        from_memory_id: 1,
        from_memory_type: 'episode',
        to_memory_id: 42,
        to_memory_type: 'skill',
        similarity: 0.4,
        uplift: 0.85,
        confidence: 0.9,
        sample_size: 12,
        evidence_ids: null,
        mechanism: 'retries reduce flake',
      },
      {
        id: 11,
        from_memory_id: 2,
        from_memory_type: 'episode',
        to_memory_id: 99,
        to_memory_type: 'note',
        similarity: 0.3,
        uplift: 0.42,
        confidence: 0.7,
        sample_size: 5,
        evidence_ids: null,
        mechanism: null,
      },
    ]);

    const { result } = await withTestReadContext(
      causalRecallHandler,
      { query: 'reduce flake', k: 5, minConfidence: 0.5 },
      { substrate: access },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].storeId).toBe('agentdb_causal_recall');
    const pred = calls[0].predicate as { sql: string; params: Record<string, unknown> };
    expect(pred.sql).toMatch(/FROM causal_edges/);
    expect(pred.sql).toMatch(/ORDER BY uplift DESC/);
    expect(pred.params).toEqual({
      minConfidence: 0.5,
      likeQuery: '%reduce flake%',
      limit: 5,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      item: {
        id: '42',
        type: 'skill',
        content: 'retries reduce flake',
        uplift: 0.85,
        causalConfidence: 0.9,
        utilityScore: 0.85,
        evidenceIds: undefined,
        mechanism: 'retries reduce flake',
      },
      score: 0.85,
      provenance: {
        storeId: 'causal_edges',
        matchType: 'semantic',
        rawScore: 0.85,
        rank: 1,
        matchedField: 'mechanism',
      },
    });
    expect(result[1].provenance.rank).toBe(2);
    expect(result[1].item.id).toBe('99');
    expect(result[1].item.content).toBe('');
    expect(result[1].item.mechanism).toBeUndefined();
  });

  it('defaults minConfidence to 0.6 and k to 10 when omitted', async () => {
    const { access, calls } = makeSqliteReadFake([]);

    await withTestReadContext(
      causalRecallHandler,
      { query: 'q' },
      { substrate: access },
    );

    const pred = calls[0].predicate as { params: Record<string, unknown> };
    expect(pred.params.minConfidence).toBe(0.6);
    expect(pred.params.limit).toBe(10);
  });

  it('passes likeQuery=null when the query is empty (no LIKE pre-filter)', async () => {
    const { access, calls } = makeSqliteReadFake([]);

    await withTestReadContext(
      causalRecallHandler,
      { query: '', k: 3 },
      { substrate: access },
    );

    const pred = calls[0].predicate as { params: Record<string, unknown> };
    expect(pred.params.likeQuery).toBeNull();
  });

  it('surfaces evidence_ids JSON on the hit only when includeEvidence: true', async () => {
    const { access } = makeSqliteReadFake([
      {
        id: 1,
        from_memory_id: 1,
        from_memory_type: 'episode',
        to_memory_id: 2,
        to_memory_type: 'fact',
        similarity: 0,
        uplift: 0.5,
        confidence: 0.8,
        sample_size: 1,
        evidence_ids: JSON.stringify(['e1', 'e2']),
        mechanism: null,
      },
    ]);

    const { result: withEvidence } = await withTestReadContext(
      causalRecallHandler,
      { query: 'q', includeEvidence: true },
      { substrate: access },
    );
    expect(withEvidence[0].item.evidenceIds).toEqual(['e1', 'e2']);

    const { access: access2 } = makeSqliteReadFake([
      {
        id: 1,
        from_memory_id: 1,
        from_memory_type: 'episode',
        to_memory_id: 2,
        to_memory_type: 'fact',
        similarity: 0,
        uplift: 0.5,
        confidence: 0.8,
        sample_size: 1,
        evidence_ids: JSON.stringify(['e1', 'e2']),
        mechanism: null,
      },
    ]);
    const { result: noEvidence } = await withTestReadContext(
      causalRecallHandler,
      { query: 'q' },
      { substrate: access2 },
    );
    expect(noEvidence[0].item.evidenceIds).toBeUndefined();
  });

  it('throws fail-loud on an unknown to_memory_type (schema invariant)', async () => {
    const { access } = makeSqliteReadFake([
      {
        id: 1,
        from_memory_id: 1,
        from_memory_type: 'episode',
        to_memory_id: 2,
        to_memory_type: 'gizmo',
        similarity: 0,
        uplift: 0.9,
        confidence: 0.9,
        sample_size: 1,
        evidence_ids: null,
        mechanism: null,
      },
    ]);

    await expect(
      withTestReadContext(causalRecallHandler, { query: 'q' }, { substrate: access }),
    ).rejects.toThrow(/unknown causal memory type 'gizmo'/i);
  });

  it('returns [] when the SQL substrate returns no rows', async () => {
    const { access } = makeSqliteReadFake([]);
    const { result } = await withTestReadContext(
      causalRecallHandler,
      { query: 'q' },
      { substrate: access },
    );
    expect(result).toEqual([]);
  });
});
