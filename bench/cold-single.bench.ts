/**
 * W1 — Cold single write benchmark
 *
 * Measures p50/p99/p999 of a single mutation through the archivist write-through
 * path against a baseline of `fs.appendFileSync` to a tempfile.
 *
 * Bands (per ADR-0180 §Migration concerns):
 *   p50  ≤ 1.3× baseline
 *   p99  ≤ 1.5× baseline
 *   hard-fail at p99 > 2.0× baseline
 *
 * Iterations: 1000 (cold writes — fsync-heavy)
 *
 * NOTE: archivist module not wired yet — the archivist call site is stubbed
 * (TODO at archivistColdWrite). Numbers in baseline.json are placeholders
 * captured from this dry run; real numbers land when the archivist code lands.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ITERATIONS = 1000;

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

function timeUs(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return (performance.now() - t0) * 1000;
}

// TODO(Phase 3): replace with real archivist.withWrite invocation once
// `@pkg/archivist` is wired. The current stub emulates the write-through
// journal shape: a single append to a journal file, no extra ceremony.
function archivistColdWrite(journalPath: string, payload: string): void {
  // Future: ctx.withWrite(() => substrate.put(table, key, payload), { reason: 'cold-single' })
  appendFileSync(journalPath, payload + '\n');
}

function baselineColdWrite(filePath: string, payload: string): void {
  appendFileSync(filePath, payload + '\n');
}

test('W1 cold single write — measures p50/p99/p999, asserts archivist vs baseline bands', () => {
  const dir = mkdtempSync(join(tmpdir(), 'w1-cold-single-'));
  const baselinePath = join(dir, 'baseline.jsonl');
  const archivistPath = join(dir, 'archivist.jsonl');
  writeFileSync(baselinePath, '');
  writeFileSync(archivistPath, '');

  try {
    // Warmup — 50 iters discarded to stabilize JIT + fs cache state
    for (let i = 0; i < 50; i++) {
      baselineColdWrite(baselinePath, `{"warmup":${i}}`);
      archivistColdWrite(archivistPath, `{"warmup":${i}}`);
    }

    const baselineUs: number[] = [];
    const archivistUs: number[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      const payload = `{"id":${i},"data":"cold-single-${i}"}`;
      baselineUs.push(timeUs(() => baselineColdWrite(baselinePath, payload)));
      archivistUs.push(timeUs(() => archivistColdWrite(archivistPath, payload)));
    }

    const baseline = summarize(baselineUs);
    const archivist = summarize(archivistUs);

    const ratio = {
      p50: archivist.p50 / baseline.p50,
      p99: archivist.p99 / baseline.p99,
    };

    // Hard-fail band
    assert.ok(
      ratio.p99 <= 2.0,
      `W1 hard-fail: archivist p99 ${archivist.p99.toFixed(2)}us / baseline ${baseline.p99.toFixed(2)}us = ${ratio.p99.toFixed(2)}× > 2.0×`,
    );

    // Regression bands (only enforced once archivist is wired — until then,
    // stub-vs-baseline ratio ≈ 1.0, so these are no-ops in Phase 2)
    assert.ok(
      ratio.p50 <= 1.3,
      `W1 p50 band: ${ratio.p50.toFixed(2)}× > 1.3×`,
    );
    assert.ok(
      ratio.p99 <= 1.5,
      `W1 p99 band: ${ratio.p99.toFixed(2)}× > 1.5×`,
    );

    // Surface numbers so the harness operator can update baseline.json
    console.log(`[W1] baseline us  p50=${baseline.p50.toFixed(2)} p99=${baseline.p99.toFixed(2)} p999=${baseline.p999.toFixed(2)}`);
    console.log(`[W1] archivist us p50=${archivist.p50.toFixed(2)} p99=${archivist.p99.toFixed(2)} p999=${archivist.p999.toFixed(2)}`);
    console.log(`[W1] ratio p50=${ratio.p50.toFixed(2)}× p99=${ratio.p99.toFixed(2)}×`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
