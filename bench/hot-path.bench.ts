/**
 * W3 — Hot-path benchmark (10k iterations)
 *
 * The hot-path handler uses a 256-entry in-flight queue + write-through
 * journal (per Follow-up #17/#18). This bench asserts the absolute hot-path
 * ceiling — NOT a ratio against any baseline.
 *
 * Absolute ceilings (per ADR-0180 §Performance and hot paths):
 *   p50   < 300 µs
 *   p99   <   2 ms
 *   p999  <   5 ms
 *
 * Iterations: 10,000 (~30s on M5 Max — runs in acceptance stage, not preflight).
 * W3_contended (multi-process p99 ≤ 5ms ceiling per #13) shares this harness
 * via the WRITER_PROCS env knob (≥2 ⇒ contended mode); contended mode is
 * exercised in CI by the parent `npm run release` spawning workers — this
 * file just measures one writer.
 *
 * NOTE: archivist hot-path handler not wired yet — stubbed (TODO at
 * hotPathWrite). The current stub simulates the 256-entry ring + post-write
 * trigger queue to measure the SHAPE; absolute numbers update once the
 * archivist hot-path lands.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ITERATIONS = 10_000;
const RING_SIZE = 256;
const P50_MAX_US = 300;
const P99_MAX_US = 2_000;
const P999_MAX_US = 5_000;

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

// Stubs the in-flight ring buffer used by the production hot-path handler.
// Production semantics: write to ring → schedule async post-write trigger →
// journal append happens off the hot path. Here we measure the on-path cost.
class HotPathRing {
  private readonly buf: Array<string | undefined> = new Array(RING_SIZE);
  private head = 0;

  push(entry: string): void {
    this.buf[this.head] = entry;
    this.head = (this.head + 1) % RING_SIZE;
  }
}

// TODO(Phase 7): replace with real archivist hot-path registration:
//   registerMutationHandler('hot.*', handler, { hotPath: true })
// Production path bypasses guards, posts to ring, schedules async journal.
function hotPathWrite(ring: HotPathRing, journalPath: string, payload: string): void {
  // Future: ctx.fastPath(payload) — guards bypassed by registration flag.
  ring.push(payload);
  // Production: this append is deferred to a post-write trigger; stub keeps
  // it inline so the bench captures the pessimistic shape until the trigger
  // queue lands.
  appendFileSync(journalPath, payload + '\n');
}

// Comparison baseline per ADR-0180 Follow-up #13 line 575:
// "Comparison baseline is fs.appendFileSync to a discarded tempfile
//  (current pending-insights.jsonl shape) — archivist p50 MUST be ≤
//  baseline p50, p99 MUST be ≤ baseline p99."
function appendFileSyncBaseline(baselinePath: string, payload: string): void {
  appendFileSync(baselinePath, payload + '\n');
}

test('W3 hot loop — 10k iters, absolute ceilings + appendFileSync baseline parity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'w3-hot-path-'));
  const journalPath = join(dir, 'hot-journal.jsonl');
  const baselinePath = join(dir, 'baseline-pending-insights.jsonl');
  writeFileSync(journalPath, '');
  writeFileSync(baselinePath, '');
  const ring = new HotPathRing();

  try {
    // --- Phase A: appendFileSync baseline ---
    // Discarded warmup
    for (let i = 0; i < 200; i++) {
      appendFileSyncBaseline(baselinePath, `{"warmup":${i}}`);
    }

    const baselineSamples: number[] = new Array(ITERATIONS);
    for (let i = 0; i < ITERATIONS; i++) {
      const payload = `{"id":${i},"baseline":true}`;
      const t0 = performance.now();
      appendFileSyncBaseline(baselinePath, payload);
      baselineSamples[i] = (performance.now() - t0) * 1000;
    }
    const baseline = summarize(baselineSamples);

    // --- Phase B: hot-path (stub) ---
    for (let i = 0; i < 200; i++) {
      hotPathWrite(ring, journalPath, `{"warmup":${i}}`);
    }

    const samples: number[] = new Array(ITERATIONS);
    for (let i = 0; i < ITERATIONS; i++) {
      const payload = `{"id":${i},"hot":true}`;
      const t0 = performance.now();
      hotPathWrite(ring, journalPath, payload);
      samples[i] = (performance.now() - t0) * 1000;
    }
    const { p50, p99, p999 } = summarize(samples);

    // Absolute ceilings (per ADR-0180 §Performance + Follow-up #13 lines 559-562)
    assert.ok(
      p50 < P50_MAX_US,
      `W3 p50 ceiling: ${p50.toFixed(2)}us ≥ ${P50_MAX_US}us`,
    );
    assert.ok(
      p99 < P99_MAX_US,
      `W3 p99 ceiling: ${p99.toFixed(2)}us ≥ ${P99_MAX_US}us`,
    );
    assert.ok(
      p999 < P999_MAX_US,
      `W3 p999 ceiling: ${p999.toFixed(2)}us ≥ ${P999_MAX_US}us`,
    );

    // Baseline parity (per Follow-up #13 line 575): hot-path MUST NOT be
    // slower than appendFileSync on p50 or p99. Until the archivist hot-path
    // wire-up lands, the stubbed hot-path includes its own inline append, so
    // this parity check is structural — it'll tighten when hotPathWrite
    // becomes a ring-only enqueue + async journal trigger.
    assert.ok(
      p50 <= baseline.p50,
      `W3 baseline parity (p50): hot-path ${p50.toFixed(2)}us > appendFileSync baseline ${baseline.p50.toFixed(2)}us`,
    );
    assert.ok(
      p99 <= baseline.p99,
      `W3 baseline parity (p99): hot-path ${p99.toFixed(2)}us > appendFileSync baseline ${baseline.p99.toFixed(2)}us`,
    );

    console.log(`[W3] baseline us p50=${baseline.p50.toFixed(2)} p99=${baseline.p99.toFixed(2)} p999=${baseline.p999.toFixed(2)}`);
    console.log(`[W3] hot-path us p50=${p50.toFixed(2)} p99=${p99.toFixed(2)} p999=${p999.toFixed(2)}`);
    console.log(`[W3] ceilings p50<${P50_MAX_US} p99<${P99_MAX_US} p999<${P999_MAX_US}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
