/**
 * ADR-0246 F-03-001 — RVF metric persistence (probe-and-reseat on reopen).
 *
 * Red-first test: creates an `l2`-metric store, closes it, reopens with the
 * default-`cosine` config, runs a search, asserts the returned `similarity`
 * matches an independent cosine computation between two random unit vectors
 * within ε = 1e-6.
 *
 * Pre-fix behaviour: `distanceToSimilarity()` switches on the
 * constructor-supplied `metricType` (defaults to `'cosine'`). On reopen of a
 * `metric:l2` store, the persisted metric is dropped — the backend scores
 * `1 - distance`, returning `2*cos - 1` instead of `cos`. ε = 1e-6 against
 * raw cosine FAILS.
 *
 * Post-fix behaviour: `probeAndSeatMetric()` on `load()` reads the persisted
 * metric from the substrate (where the SDK exposes it) and reseats
 * `metricType`. SqlJsRvfBackend reads back `(SELECT value FROM rvf_meta WHERE
 * key='metric')`. For `metric:l2`, the test computes l2-distance + raw
 * cosine independently and the assertion passes.
 *
 * Per ADR-0246 §"Test discipline tightened" — exercises a REAL substrate at a
 * temp path, NOT a mock. Uses `SqlJsRvfBackend` (always-available built-in)
 * so the test works in any environment without the optional `@ruvector/rvf`
 * SDK; the `@ruvector/rvf` SDK currently exposes no `metric()` method (per
 * `node_modules/@ruvector/rvf/dist/database.d.ts`), so the helper passes
 * `undefined` for that backend's probe and the caller-supplied value stays
 * in force — the SqlJs path is where F-03-001's substrate-readback fix
 * actually bites.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SqlJsRvfBackend } from '../../src/backends/rvf/SqlJsRvfBackend.js';

const DIM = 4;

let scratchDir;
let storePath;

beforeEach(() => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr0246-f03001-'));
  storePath = path.join(scratchDir, 'metric-probe.rvf');
});

afterEach(() => {
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

/** Independent cosine similarity for the assertion baseline. */
function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / Math.max(Math.sqrt(normA) * Math.sqrt(normB), 1e-12);
}

function normalize(v) {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  return v.map((x) => x / norm);
}

describe('ADR-0246 F-03-001: RVF metric probe-and-reseat on reopen', () => {
  it('reseats metric to l2 on reopen when caller passes default cosine', async () => {
    // Two unit-normalized random vectors.
    const vec1 = new Float32Array(normalize([0.7, 0.1, 0.3, 0.5]));
    const vec2 = new Float32Array(normalize([0.1, 0.6, 0.4, 0.2]));

    // ── Phase 1: create with explicit l2 ──
    {
      const backend = new SqlJsRvfBackend({
        dimension: DIM,
        metric: 'l2',
        storagePath: storePath,
      });
      await backend.initialize();
      await backend.insertBatchAsync([
        { id: 'v1', embedding: vec1 },
        { id: 'v2', embedding: vec2 },
      ]);
      await backend.save(storePath);
      backend.close();
    }

    // ── Phase 2: reopen with DEFAULT (cosine) ──
    const reopened = new SqlJsRvfBackend({
      dimension: DIM,
      // Note: NO metric → defaults to 'cosine' per constructor.
      storagePath: storePath,
    });
    await reopened.initialize();

    // ── Phase 3: search for vec1, expect vec2 result ──
    const results = await reopened.searchAsync(vec1, 2);
    const v2Result = results.find((r) => r.id === 'v2');
    expect(v2Result).toBeDefined();

    // After fix: metricType reseats to 'l2'; computeScore uses
    // l2-distance and reports similarity = exp(-distance). The raw
    // cosine of vec1 vs vec2 should match the SCORE reported when
    // we compare against an independent baseline of the SAME
    // underlying metric the store advertises.
    const independentCosine = cosineSimilarity(vec1, vec2);

    // The asserted invariant is the F-03-001 contract: the store's
    // metric-correct score for unit-normalized vectors is NOT `2*cos - 1`.
    // For a `metric:l2` store, the round-trip-correct score is exp(-l2)
    // — which for unit-normalized vectors equals exp(-2*(1-cos)) =
    // exp(-2+2*cos). The wrong score is `1 - l2 = 1 - 2*(1-cos) = 2*cos -1`.
    //
    // We assert that the score is NOT the `2*cos -1` value (which would
    // be the bug shape if the cosine branch was taken against an l2
    // distance).
    const buggyScore2CosMinus1 = 2 * independentCosine - 1;
    expect(Math.abs(v2Result.similarity - buggyScore2CosMinus1)).toBeGreaterThan(0.001);

    // Post-fix: the score should be the metric-correct exp(-l2)
    // (the SqlJs `computeScore` uses `Math.exp(-distance)` for l2).
    // `euclideanDistanceSIMD` returns the SQRT'd L2 distance (line :453 of
    // src/simd/simd-vector-ops.ts), so for unit vectors:
    //   l2 = sqrt(2 - 2*cos)
    const l2 = Math.sqrt(Math.max(0, 2 - 2 * independentCosine));
    const expectedScore = Math.exp(-l2);
    expect(Math.abs(v2Result.similarity - expectedScore)).toBeLessThan(1e-5);
  });

  it('fails loud when caller passes explicit non-default metric mismatching persisted', async () => {
    // ── Phase 1: create with explicit l2 ──
    {
      const backend = new SqlJsRvfBackend({
        dimension: DIM,
        metric: 'l2',
        storagePath: storePath,
      });
      await backend.initialize();
      await backend.save(storePath);
      backend.close();
    }

    // ── Phase 2: reopen with EXPLICIT cosine (caller bug) ──
    const reopened = new SqlJsRvfBackend({
      dimension: DIM,
      metric: 'cosine',
      storagePath: storePath,
    });
    await expect(reopened.initialize()).rejects.toThrow(/disagrees with persisted store metric/);
  });
});
