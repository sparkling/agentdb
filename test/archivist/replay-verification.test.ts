// charter: replay-verification
// ADR-0263 — unit tests for the replay-verification harness.
//
// Each test writes a synthetic audit JSONL to a tempfile, then calls
// `verifyAuditLog` and asserts the expected `ReplayReport` shape.

import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { verifyAuditLog } from '../../src/archivist/replay-verification.ts';
import type { AuditEntry, AuditState } from '../../src/archivist/audit-types.ts';

function buildEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    auditId: 'audit-1',
    originatingTool: 'memory_store',
    processId: { pid: 1, role: 'cli', sessionId: 'sess-1' },
    timestamp: Date.now(),
    payloadHash: 'sha256:' + '0'.repeat(64),
    state: 'applied',
    contextVersion: 1,
    ...overrides,
  };
}

function writeJsonl(dir: string, entries: AuditEntry[]): string {
  const p = join(dir, 'audit.jsonl');
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(p, lines, 'utf8');
  return p;
}

test('verifyAuditLog: empty / missing log → pass with zero entries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-verify-empty-'));
  try {
    const p = join(dir, 'audit.jsonl');
    // File doesn't exist — function should return pass with 0 entries.
    const r1 = await verifyAuditLog({ auditPath: p });
    strictEqual(r1.entriesRead, 0);
    strictEqual(r1.overall, 'pass');

    // Write an empty file — same result.
    writeFileSync(p, '', 'utf8');
    const r2 = await verifyAuditLog({ auditPath: p });
    strictEqual(r2.entriesRead, 0);
    strictEqual(r2.overall, 'pass');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyAuditLog: single intent→applied chain → pass', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-verify-happy-'));
  try {
    const p = writeJsonl(dir, [
      buildEntry({ auditId: 'a1', state: 'intent' }),
      buildEntry({ auditId: 'a1', state: 'applied' }),
    ]);
    const r = await verifyAuditLog({ auditPath: p });
    strictEqual(r.overall, 'pass', JSON.stringify(r.verdicts));
    strictEqual(r.entriesRead, 2);
    strictEqual(r.rootsCount, 1);
    strictEqual(r.maxDepth, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyAuditLog: depth ≤3 PASSes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-verify-depth3-'));
  try {
    const p = writeJsonl(dir, [
      buildEntry({ auditId: 'root', state: 'intent' }),
      buildEntry({ auditId: 'root', state: 'applied' }),
      buildEntry({ auditId: 'c1', parentAuditId: 'root', state: 'applied' }),
      buildEntry({ auditId: 'c2', parentAuditId: 'c1', state: 'applied' }),
      buildEntry({ auditId: 'c3', parentAuditId: 'c2', state: 'applied' }),
    ]);
    // Tree depth = 3 (root → c1 → c2 → c3). Default max = 3 → PASS.
    // But fanout: root has 3 applied descendants (c1, c2, c3) — that's a
    // fanout violation under default maxFanout=1. So override maxFanout
    // for this test to isolate depth.
    const r = await verifyAuditLog({ auditPath: p, maxFanout: 100 });
    const depthVerdict = r.verdicts.find((v) => v.rule === 'depth-ceiling');
    strictEqual(depthVerdict?.verdict, 'pass', `depth verdict detail: ${depthVerdict?.detail}`);
    strictEqual(r.maxDepth, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyAuditLog: depth >3 FAILs with detail', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-verify-depth4-'));
  try {
    const p = writeJsonl(dir, [
      buildEntry({ auditId: 'root', state: 'applied' }),
      buildEntry({ auditId: 'c1', parentAuditId: 'root', state: 'applied' }),
      buildEntry({ auditId: 'c2', parentAuditId: 'c1', state: 'applied' }),
      buildEntry({ auditId: 'c3', parentAuditId: 'c2', state: 'applied' }),
      buildEntry({ auditId: 'c4', parentAuditId: 'c3', state: 'applied' }),
    ]);
    const r = await verifyAuditLog({ auditPath: p, maxFanout: 100 });
    const depthVerdict = r.verdicts.find((v) => v.rule === 'depth-ceiling');
    strictEqual(depthVerdict?.verdict, 'fail');
    ok(depthVerdict?.detail?.includes('depth 4'));
    strictEqual(r.overall, 'fail');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyAuditLog: fanout amplification (>1 applied descendants per root) FAILs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-verify-fanout-'));
  try {
    // ADR-0085 silent-fanout shape: one root spawns 3 applied descendants.
    // Default maxFanout=1 → FAIL.
    const p = writeJsonl(dir, [
      buildEntry({ auditId: 'root', state: 'applied' }),
      buildEntry({ auditId: 'c1', parentAuditId: 'root', state: 'applied' }),
      buildEntry({ auditId: 'c2', parentAuditId: 'root', state: 'applied' }),
      buildEntry({ auditId: 'c3', parentAuditId: 'root', state: 'applied' }),
    ]);
    const r = await verifyAuditLog({ auditPath: p, maxDepth: 100 });
    const fanoutVerdict = r.verdicts.find((v) => v.rule === 'no-fanout-amplification');
    strictEqual(fanoutVerdict?.verdict, 'fail');
    ok(fanoutVerdict?.detail?.includes('descendants'));
    strictEqual(r.overall, 'fail');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyAuditLog: invalid state transition (applied→failed) FAILs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-verify-state-'));
  try {
    const p = writeJsonl(dir, [
      buildEntry({ auditId: 'a1', state: 'applied' }),
      // applied → failed is invalid per VALID_TRANSITIONS in source.
      buildEntry({ auditId: 'a1', state: 'failed' }),
    ]);
    const r = await verifyAuditLog({ auditPath: p });
    const stateVerdict = r.verdicts.find((v) => v.rule === 'state-progression');
    strictEqual(stateVerdict?.verdict, 'fail');
    ok(stateVerdict?.detail?.includes('applied → failed'));
    strictEqual(r.overall, 'fail');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyAuditLog: stuck-intent (multiple intent, no terminal) FAILs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-verify-intent-'));
  try {
    const p = writeJsonl(dir, [
      buildEntry({ auditId: 'a1', state: 'intent' }),
      buildEntry({ auditId: 'a1', state: 'intent' }),
    ]);
    const r = await verifyAuditLog({ auditPath: p });
    const terminalVerdict = r.verdicts.find((v) => v.rule === 'terminal-state');
    strictEqual(terminalVerdict?.verdict, 'fail');
    ok(terminalVerdict?.detail?.includes('intent entries without terminal'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyAuditLog: rejected → rejected stays valid (rejection finality)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-verify-rejected-'));
  try {
    const p = writeJsonl(dir, [
      buildEntry({ auditId: 'a1', state: 'intent' }),
      buildEntry({ auditId: 'a1', state: 'rejected' }),
    ]);
    const r = await verifyAuditLog({ auditPath: p });
    strictEqual(r.overall, 'pass', JSON.stringify(r.verdicts));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyAuditLog: malformed JSON line THROWS (no silent skip)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-verify-malformed-'));
  try {
    const p = join(dir, 'audit.jsonl');
    writeFileSync(p, '{"valid":"first"}\n{not valid json}\n', 'utf8');
    let threw = false;
    try {
      await verifyAuditLog({ auditPath: p });
    } catch (e) {
      threw = true;
      ok((e as Error).message.includes('malformed JSON'));
      ok((e as Error).message.includes('line 2'));
    }
    strictEqual(threw, true, 'malformed JSON must throw, not silently skip');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyAuditLog: no cycle in parent chain (defensive)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-verify-cycle-'));
  try {
    // Construct a cycle: a → b → a. The depth-walk must NOT infinite-loop.
    const p = writeJsonl(dir, [
      buildEntry({ auditId: 'a', parentAuditId: 'b', state: 'applied' }),
      buildEntry({ auditId: 'b', parentAuditId: 'a', state: 'applied' }),
    ]);
    // No roots (both have parents). The walk completes with no roots, so
    // verdicts pass trivially for depth/fanout. Just assert the harness
    // terminates and doesn't infinite-loop.
    const r = await verifyAuditLog({ auditPath: p });
    ok(r.entriesRead === 2);
    strictEqual(r.rootsCount, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
