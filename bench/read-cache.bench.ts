/**
 * W4 — Read cache hit vs miss benchmark
 *
 * Records BOTH numbers (cache-hit and substrate-miss) in the same run so the
 * speed-up ratio is local (immune to host noise drift between runs). Asserts
 * cache-hit p50 ≥ 10× faster than the same-run miss measurement (per
 * ADR-0180 §Performance and hot paths).
 *
 * Iterations: 2000 each (hit and miss are interleaved-batched to share
 * fs-cache state). Cache-miss path simulates a small JSON read; cache-hit
 * path reads from an in-memory Map.
 *
 * NOTE: archivist read cache not wired yet — stubbed (TODO at archivistRead).
 * Production cache lives on `SubstrateAccess.withRead`; the Map stub here
 * preserves the lookup shape.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ITERATIONS = 2_000;
const KEY_COUNT = 100;
const SPEEDUP_MIN = 10;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(samplesUs: number[]) {
  const sorted = [...samplesUs].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p99: percentile(sorted, 99),
    p999: percentile(sorted, 99.9),
  };
}

function timeUs(fn: () => unknown): number {
  const t0 = performance.now();
  fn();
  return (performance.now() - t0) * 1000;
}

// TODO(Phase 3): replace with real archivist read cache:
//   ctx.substrate.withRead(table, key, { cache: true })
// Production caches keyed reads; this Map stub preserves the lookup shape.
class ReadCache {
  private readonly map = new Map<string, unknown>();
  get(k: string): unknown { return this.map.get(k); }
  set(k: string, v: unknown): void { this.map.set(k, v); }
  has(k: string): boolean { return this.map.has(k); }
}

function archivistRead(cache: ReadCache, dir: string, key: string): unknown {
  // Future: ctx.substrate.withRead(...) — cache populated on first read.
  if (cache.has(key)) return cache.get(key);
  const payload = JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8'));
  cache.set(key, payload);
  return payload;
}

function substrateMiss(dir: string, key: string): unknown {
  // Models a substrate read that always touches disk (no cache).
  return JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8'));
}

test('W4 read cache — measures hit p50, miss p50; asserts hit ≥10× faster than miss', () => {
  const dir = mkdtempSync(join(tmpdir(), 'w4-read-cache-'));

  try {
    // Pre-populate KEY_COUNT JSON files.
    for (let i = 0; i < KEY_COUNT; i++) {
      writeFileSync(join(dir, `key-${i}.json`), JSON.stringify({ id: i, payload: `value-${i}` }));
    }

    const cache = new ReadCache();
    // Warmup the cache for half the keys (so we have a hot set).
    for (let i = 0; i < KEY_COUNT / 2; i++) {
      archivistRead(cache, dir, `key-${i}`);
    }

    const hitUs: number[] = [];
    const missUs: number[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      // Hit: read from the warm set.
      const hitKey = `key-${i % (KEY_COUNT / 2)}`;
      hitUs.push(timeUs(() => archivistRead(cache, dir, hitKey)));

      // Miss: always go to disk (fresh substrate-miss measurement per iter).
      const missKey = `key-${(i % (KEY_COUNT / 2)) + KEY_COUNT / 2}`;
      missUs.push(timeUs(() => substrateMiss(dir, missKey)));
    }

    const hit = summarize(hitUs);
    const miss = summarize(missUs);

    const speedup = miss.p50 / hit.p50;

    assert.ok(
      speedup >= SPEEDUP_MIN,
      `W4 speedup: miss p50 ${miss.p50.toFixed(2)}us / hit p50 ${hit.p50.toFixed(2)}us = ${speedup.toFixed(2)}× < ${SPEEDUP_MIN}×`,
    );

    console.log(`[W4] hit us  p50=${hit.p50.toFixed(2)} p99=${hit.p99.toFixed(2)} p999=${hit.p999.toFixed(2)}`);
    console.log(`[W4] miss us p50=${miss.p50.toFixed(2)} p99=${miss.p99.toFixed(2)} p999=${miss.p999.toFixed(2)}`);
    console.log(`[W4] speedup ${speedup.toFixed(2)}× (min ${SPEEDUP_MIN}×)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
