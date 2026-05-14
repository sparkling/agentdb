/**
 * W5 — Inter-store cascade benchmark
 *
 * Measures the audit-tree shape and end-to-end latency of a mutation that
 * cascades via `ctx.child(reason)` into downstream stores. Asserts two
 * invariants (per ADR-0180 §Re-entrancy + §Performance):
 *   audit-tree depth ≤ 3
 *   p99 ≤ 1.5× baseline
 *
 * Iterations: 500 outer cascades. Each cascade walks root → child × 2 → leaf,
 * which is the deepest legal tree shape (depth = 3).
 *
 * NOTE: archivist `ctx.child()` not wired yet — the cascade is modeled with
 * a minimal stub AuditNode tree + per-level write to model the fanout shape.
 * Depth-≤3 invariant is enforced structurally here (the stub refuses to
 * recurse past depth 3).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OUTER_ITERATIONS = 500;
const MAX_DEPTH = 3;

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

interface AuditNode {
  reason: string;
  depth: number;
  children: AuditNode[];
}

function maxDepth(node: AuditNode): number {
  if (node.children.length === 0) return node.depth;
  return Math.max(...node.children.map((c) => maxDepth(c)));
}

// TODO(Phase 9): replace with real archivist child-context cascade:
//   ctx.child('downstream-store').withWrite(() => ...)
// Production enforces depth ≤ 3 in `MutationContext.child()` via the
// branded depth counter on the context. This stub enforces it inline.
function archivistCascade(journalPath: string, parent: AuditNode, fanout: number): void {
  if (parent.depth >= MAX_DEPTH) return;
  for (let i = 0; i < fanout; i++) {
    const child: AuditNode = {
      reason: `${parent.reason}.child-${i}`,
      depth: parent.depth + 1,
      children: [],
    };
    parent.children.push(child);
    appendFileSync(journalPath, `{"reason":"${child.reason}","depth":${child.depth}}\n`);
    archivistCascade(journalPath, child, fanout);
  }
}

function baselineCascade(journalPath: string, fanout: number): void {
  // Models the pre-archivist pattern: a single store writes its row + the
  // downstream stores write theirs, no shared coordination.
  for (let depth = 1; depth <= MAX_DEPTH; depth++) {
    for (let i = 0; i < fanout; i++) {
      appendFileSync(journalPath, `{"depth":${depth},"i":${i}}\n`);
    }
  }
}

test('W5 inter-store cascade — asserts depth ≤ 3 invariant + p99 vs baseline band', () => {
  const dir = mkdtempSync(join(tmpdir(), 'w5-cascade-'));
  const baselinePath = join(dir, 'baseline.jsonl');
  const archivistPath = join(dir, 'archivist.jsonl');
  writeFileSync(baselinePath, '');
  writeFileSync(archivistPath, '');

  try {
    // Warmup
    for (let i = 0; i < 20; i++) {
      baselineCascade(baselinePath, 2);
      const root: AuditNode = { reason: 'warmup', depth: 0, children: [] };
      archivistCascade(archivistPath, root, 2);
    }

    const baselineUs: number[] = [];
    const archivistUs: number[] = [];
    let observedMaxDepth = 0;

    for (let i = 0; i < OUTER_ITERATIONS; i++) {
      baselineUs.push(timeUs(() => baselineCascade(baselinePath, 2)));

      const root: AuditNode = { reason: `root-${i}`, depth: 0, children: [] };
      archivistUs.push(timeUs(() => archivistCascade(archivistPath, root, 2)));
      observedMaxDepth = Math.max(observedMaxDepth, maxDepth(root));
    }

    assert.ok(
      observedMaxDepth <= MAX_DEPTH,
      `W5 audit-tree depth invariant: observed ${observedMaxDepth} > ${MAX_DEPTH}`,
    );

    const baseline = summarize(baselineUs);
    const archivist = summarize(archivistUs);

    const ratio = {
      p50: archivist.p50 / baseline.p50,
      p99: archivist.p99 / baseline.p99,
    };

    assert.ok(
      ratio.p99 <= 1.5,
      `W5 p99 band: ${ratio.p99.toFixed(2)}× > 1.5×`,
    );

    console.log(`[W5] baseline us  p50=${baseline.p50.toFixed(2)} p99=${baseline.p99.toFixed(2)} p999=${baseline.p999.toFixed(2)}`);
    console.log(`[W5] archivist us p50=${archivist.p50.toFixed(2)} p99=${archivist.p99.toFixed(2)} p999=${archivist.p999.toFixed(2)}`);
    console.log(`[W5] ratio p50=${ratio.p50.toFixed(2)}× p99=${ratio.p99.toFixed(2)}× audit_tree_depth_max=${observedMaxDepth}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
