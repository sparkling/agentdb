// charter: hot-path-fast-path
// 256-entry single-producer queue between the hot-path caller and the
// write-through audit journal (ADR-0180 #17). Power-of-two capacity so
// `idx & (CAP-1)` replaces modulo. Drain trigger is an immediate microtask;
// at-capacity producer blocks for bounded µs-scale time (never drops).

import type { AuditEntry } from './audit-types.js';
import { writeThroughEntry } from './audit-writer.js';

const CAP = 256;
const MASK = CAP - 1;

export class HotPathQueue {
  private readonly buf: Array<AuditEntry | undefined> = new Array(CAP);
  private head = 0;
  private tail = 0;
  private count = 0;
  private draining = false;
  private pendingDrain: Promise<void> | null = null;

  enqueue(entry: AuditEntry): void {
    while (this.count >= CAP) {
      void this.drainOne();
    }
    this.buf[this.head] = entry;
    this.head = (this.head + 1) & MASK;
    this.count++;
    if (!this.draining && !this.pendingDrain) {
      queueMicrotask(() => {
        this.pendingDrain = this.drain();
      });
    }
  }

  get size(): number {
    return this.count;
  }

  private drainOne(): Promise<void> {
    const entry = this.buf[this.tail];
    this.buf[this.tail] = undefined;
    this.tail = (this.tail + 1) & MASK;
    this.count--;
    if (!entry) return Promise.resolve();
    return writeThroughEntry(entry).catch((err) => {
      // Surface fatal errors per feedback-best-effort-must-rethrow-fatals.md.
      // The producer has already returned synchronously; rethrow on the
      // microtask stack so it bubbles to process-level handlers.
      queueMicrotask(() => {
        throw err;
      });
    });
  }

  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.count > 0) {
        await this.drainOne();
      }
    } finally {
      this.draining = false;
      this.pendingDrain = null;
    }
  }

  async flush(): Promise<void> {
    if (this.pendingDrain) await this.pendingDrain;
    if (this.count > 0) await this.drain();
  }
}

let sharedQueue: HotPathQueue | null = null;

export function getSharedHotPathQueue(): HotPathQueue {
  if (!sharedQueue) sharedQueue = new HotPathQueue();
  return sharedQueue;
}

// Test seam — see audit-writer.__resetForTests.
export function __resetSharedQueueForTests(): void {
  sharedQueue = null;
}
