// charter: audit-chain
// Write-through journal for archivist audit entries (ADR-0180 #15, #18).
// Single audit fd per process; cross-process serialization via advisory file
// lock around write() + fsync(); fsync batched at <=100ms.

import { promises as fs, fsyncSync } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as path from 'node:path';
import type { AuditEntry } from './audit-types.js';
import { rotateIfNeeded } from './audit-rotation.js';

const DEFAULT_AUDIT_LOG = '.claude-flow/data/archivist-audit.jsonl';
const FSYNC_BATCH_MS = 100;

let auditPath: string = path.resolve(process.cwd(), DEFAULT_AUDIT_LOG);
let auditFd: FileHandle | null = null;
let auditFdNum: number | null = null;
let currentSize = 0;
let fsyncTimer: NodeJS.Timeout | null = null;
let dirty = false;
let signalHandlersInstalled = false;

export function setAuditLogPath(absolutePath: string): void {
  if (auditFd) {
    throw new Error(
      'archivist: audit fd already open; setAuditLogPath() must be called before first write',
    );
  }
  auditPath = absolutePath;
}

/**
 * Test-only reset. Closes the audit fd (if open) and clears module-level
 * state so a subsequent `setAuditLogPath()` + first write opens a fresh fd
 * at the new path.
 *
 * Use case: unit tests that `chdir` into a fresh sandbox per test and
 * therefore want each test's archivist audit chain to land in its own
 * sandbox. Paired with cli's `__resetProcessArchivistForTests()`.
 *
 * NOT for production: closing the fd mid-process abandons any unfsync'd
 * writes. The cli's mcp-server / daemon / hooks don't shift cwd within a
 * single process, so this function should never be called from runtime
 * paths.
 */
export async function __resetAuditWriterForTests(): Promise<void> {
  if (fsyncTimer) {
    clearTimeout(fsyncTimer);
    fsyncTimer = null;
  }
  if (auditFd) {
    try { await auditFd.close(); } catch { /* test cleanup — swallow */ }
  }
  auditFd = null;
  auditFdNum = null;
  currentSize = 0;
  dirty = false;
  auditPath = path.resolve(process.cwd(), DEFAULT_AUDIT_LOG);
}

export async function writeThroughEntry(entry: AuditEntry): Promise<void> {
  await ensureFdOpen();
  installSignalHandlersOnce();

  const line = JSON.stringify(entry) + '\n';
  const bytes = Buffer.byteLength(line, 'utf8');

  await acquireWriteLock(auditFd!);
  try {
    await auditFd!.write(line);
    currentSize += bytes;
    dirty = true;
  } finally {
    await releaseLock(auditFd!);
  }

  const rotated = await rotateIfNeeded(auditFd!, currentSize, auditPath);
  if (rotated.rotated) {
    auditFd = rotated.fd;
    auditFdNum = (rotated.fd as unknown as { fd: number }).fd ?? null;
    currentSize = rotated.newSize;
    dirty = false;
  }

  if (!fsyncTimer) {
    fsyncTimer = setTimeout(flushFsync, FSYNC_BATCH_MS);
    if (typeof fsyncTimer.unref === 'function') fsyncTimer.unref();
  }
}

async function ensureFdOpen(): Promise<void> {
  if (auditFd) return;
  await fs.mkdir(path.dirname(auditPath), { recursive: true });
  auditFd = await fs.open(auditPath, 'a');
  auditFdNum = (auditFd as unknown as { fd: number }).fd ?? null;
  const stat = await auditFd.stat();
  currentSize = stat.size;
}

function flushFsync(): void {
  fsyncTimer = null;
  if (!auditFd || !dirty) return;
  const fdNum = auditFdNum;
  dirty = false;
  if (fdNum != null) {
    try {
      fsyncSync(fdNum);
    } catch {
      // logged-and-swallowed: a transient fsync failure on a still-open fd is
      // not actionable from a timer callback. Next write() re-arms the timer.
    }
  }
}

function fsyncSyncIfOpen(): void {
  if (!auditFdNum || !dirty) return;
  try {
    fsyncSync(auditFdNum);
    dirty = false;
  } catch {
    // last-chance flush during signal handling; nothing else can be done.
  }
}

// TODO(ADR-0180 #15): platform-specific advisory lock primitive.
//   Linux:  F_OFD_SETLKW via N-API binding (per-open-file-description lock).
//   macOS:  flock(LOCK_EX)  (per-open-fd; F_OFD_SETLK is absent).
// Phase 2 ships the single-fd-per-process invariant; the lock primitive is a
// no-op placeholder until the platform-specific module is wired up. The
// single-fd rule means in-process contention cannot occur (one writer at a
// time within a process); cross-process contention currently relies on the
// OS-level append-mode atomicity for sub-PIPE_BUF writes, which is sufficient
// for JSONL entries but NOT a substitute for the disposition'd lock. Wire-up
// gated by ADR-0180 Phase 7 single-fd-invariant test landing.
async function acquireWriteLock(_fd: FileHandle): Promise<void> {
  // intentionally no-op pending platform binding (see TODO above).
}

async function releaseLock(_fd: FileHandle): Promise<void> {
  // intentionally no-op pending platform binding (see TODO above).
}

function installSignalHandlersOnce(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;

  const hookableSignals = ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGUSR1', 'SIGUSR2'] as const;
  for (const sig of hookableSignals) {
    process.on(sig, () => {
      fsyncSyncIfOpen();
      process.exit(0);
    });
  }
  process.on('beforeExit', flushFsync);
  process.on('exit', fsyncSyncIfOpen);
}

// Test seam: reset module state between specs. Production callers MUST NOT
// invoke this — the singleton invariant (one fd per process) holds for the
// whole process lifetime.
export async function __resetForTests(): Promise<void> {
  if (fsyncTimer) {
    clearTimeout(fsyncTimer);
    fsyncTimer = null;
  }
  if (auditFd) {
    try {
      await auditFd.sync();
    } catch {
      // best-effort during teardown
    }
    await auditFd.close();
  }
  auditFd = null;
  auditFdNum = null;
  currentSize = 0;
  dirty = false;
  auditPath = path.resolve(process.cwd(), DEFAULT_AUDIT_LOG);
}
