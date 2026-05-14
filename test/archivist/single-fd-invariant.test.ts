// charter: audit-chain
// Asserts the single-fd-per-process invariant for the audit-writer module
// (ADR-0180 §Open Follow-up #15 disposition). The audit-writer module owns
// exactly ONE open fd against archivist-audit.jsonl for the process lifetime;
// this is what lets `F_OFD_SETLKW` on Linux and `flock(LOCK_EX)` on macOS be
// functionally equivalent without per-platform branches.

import { test } from 'node:test';
import { strictEqual } from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readdirSync, readlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import {
  writeThroughEntry,
  setAuditLogPath,
  __resetForTests,
} from '../../src/archivist/audit-writer.ts';
import type { AuditEntry } from '../../src/archivist/audit-types.ts';

const AUDIT_LOG_BASENAME = 'archivist-audit.jsonl';

function buildEntry(): AuditEntry {
  return {
    auditId: 'single-fd-invariant-test',
    originatingTool: 'test',
    processId: { pid: process.pid, role: 'cli', sessionId: 'single-fd-test' },
    timestamp: Date.now(),
    payloadHash: 'sha256:0'.padEnd(71, '0'),
    state: 'intent',
    contextVersion: 1,
  };
}

function countAuditFdsDarwin(auditPath: string): number {
  const out = execSync(`lsof -p ${process.pid}`, { encoding: 'utf8' });
  let count = 0;
  for (const line of out.split('\n')) {
    if (!line) continue;
    if (line.endsWith(auditPath) || line.includes(`/${AUDIT_LOG_BASENAME}`)) {
      if (line.includes(auditPath)) count += 1;
    }
  }
  return count;
}

function countAuditFdsLinux(auditPath: string): number {
  const fdDir = `/proc/${process.pid}/fd`;
  let count = 0;
  for (const entry of readdirSync(fdDir)) {
    let target: string;
    try {
      target = readlinkSync(path.join(fdDir, entry));
    } catch {
      continue;
    }
    if (target === auditPath) count += 1;
  }
  return count;
}

test('audit-writer maintains exactly one audit fd per process (single-fd-per-process invariant, ADR-0180 #15)', async (t) => {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    t.skip(`platform ${process.platform} not supported by this invariant test`);
    return;
  }

  await __resetForTests();
  const dir = mkdtempSync(path.join(tmpdir(), 'archivist-single-fd-'));
  const auditPath = path.join(dir, AUDIT_LOG_BASENAME);
  setAuditLogPath(auditPath);

  await writeThroughEntry(buildEntry());
  await writeThroughEntry(buildEntry());

  const count =
    process.platform === 'darwin'
      ? countAuditFdsDarwin(auditPath)
      : countAuditFdsLinux(auditPath);

  strictEqual(
    count,
    1,
    `expected exactly 1 fd against ${auditPath} via ${
      process.platform === 'darwin' ? 'lsof -p $$' : '/proc/self/fd/'
    }, observed ${count}`,
  );
});
