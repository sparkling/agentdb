/**
 * W2 — Cold bulk write benchmark
 *
 * Measures p50/p99/p999 of bulk-mode writes through the archivist's
 * `withBulkWrite` shape (multi-row insertion with single fsync at end).
 *
 * Bands (per ADR-0180 §Migration concerns):
 *   p50 ≤ 1.2× baseline
 *   p99 ≤ 1.5× baseline
 *
 * Iterations: 200 outer (each outer ≡ a bulk of 50 rows = 10k row-writes total).
 * Bulk writes are larger than single writes, so iteration count is lower.
 *
 * NOTE: archivist `withBulkWrite` not wired yet — stubbed (TODO at
 * archivistBulkWrite). Real shape: one `ctx.substrate.withBulkWrite` call
 * carrying `{intent, count, checksum, tableList}` per Phase 6 manifest design.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OUTER_ITERATIONS = 200;
const BULK_SIZE = 50;

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

// TODO(Phase 3-6): replace with real archivist `withBulkWrite` invocation.
// Phase 6's `agentdb migrate` and Phase 9 SyncCoordinator depend on manifest
// equality. Stub emits a manifest sentinel + the bulk payload as a single
// append to model the "one fsync per bulk" semantics.
function archivistBulkWrite(journalPath: string, rows: readonly string[]): void {
  // Future: ctx.substrate.withBulkWrite({ intent: 'cold-bulk', count: rows.length },
  //                                     (bulk) => rows.forEach((r) => bulk.append(r)))
  const manifest = `{"intent":"cold-bulk","count":${rows.length},"checksum":"stub"}`;
  const body = rows.join('\n');
  appendFileSync(journalPath, manifest + '\n' + body + '\n');
}

function baselineBulkWrite(filePath: string, rows: readonly string[]): void {
  appendFileSync(filePath, rows.join('\n') + '\n');
}

test('W2 cold bulk write — measures p50/p99/p999, asserts archivist vs baseline bands', () => {
  const dir = mkdtempSync(join(tmpdir(), 'w2-cold-bulk-'));
  const baselinePath = join(dir, 'baseline.jsonl');
  const archivistPath = join(dir, 'archivist.jsonl');
  writeFileSync(baselinePath, '');
  writeFileSync(archivistPath, '');

  try {
    // Warmup — 10 outer iterations discarded
    const warmupRows = Array.from({ length: BULK_SIZE }, (_, i) => `{"warmup":${i}}`);
    for (let i = 0; i < 10; i++) {
      baselineBulkWrite(baselinePath, warmupRows);
      archivistBulkWrite(archivistPath, warmupRows);
    }

    const baselineUs: number[] = [];
    const archivistUs: number[] = [];

    for (let outer = 0; outer < OUTER_ITERATIONS; outer++) {
      const rows = Array.from(
        { length: BULK_SIZE },
        (_, i) => `{"outer":${outer},"id":${i},"data":"bulk-${outer}-${i}"}`,
      );
      baselineUs.push(timeUs(() => baselineBulkWrite(baselinePath, rows)));
      archivistUs.push(timeUs(() => archivistBulkWrite(archivistPath, rows)));
    }

    const baseline = summarize(baselineUs);
    const archivist = summarize(archivistUs);

    const ratio = {
      p50: archivist.p50 / baseline.p50,
      p99: archivist.p99 / baseline.p99,
    };

    assert.ok(
      ratio.p50 <= 1.2,
      `W2 p50 band: ${ratio.p50.toFixed(2)}× > 1.2×`,
    );
    assert.ok(
      ratio.p99 <= 1.5,
      `W2 p99 band: ${ratio.p99.toFixed(2)}× > 1.5×`,
    );

    console.log(`[W2] baseline us  p50=${baseline.p50.toFixed(2)} p99=${baseline.p99.toFixed(2)} p999=${baseline.p999.toFixed(2)}`);
    console.log(`[W2] archivist us p50=${archivist.p50.toFixed(2)} p99=${archivist.p99.toFixed(2)} p999=${archivist.p999.toFixed(2)}`);
    console.log(`[W2] ratio p50=${ratio.p50.toFixed(2)}× p99=${ratio.p99.toFixed(2)}×`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
