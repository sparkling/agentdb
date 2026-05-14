// charter: audit-chain
// Size-based rotation for archivist-audit.jsonl per ADR-0180 #15.
// Rotates at 100 MiB to archivist-audit.<n>.jsonl; each rotated file gets a
// floor.marker sidecar so replay can establish per-segment lower bounds.

import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as path from 'node:path';

export const ROTATION_THRESHOLD_BYTES = 100 * 1024 * 1024;

export interface RotationResult {
  readonly rotated: boolean;
  readonly fd: FileHandle;
  readonly newSize: number;
  readonly rotatedPath?: string;
}

export async function rotateIfNeeded(
  fd: FileHandle,
  currentSize: number,
  auditPath: string,
): Promise<RotationResult> {
  if (currentSize < ROTATION_THRESHOLD_BYTES) {
    return { rotated: false, fd, newSize: currentSize };
  }

  await fd.sync();
  await fd.close();

  const dir = path.dirname(auditPath);
  const base = path.basename(auditPath, '.jsonl');
  const nextIndex = await nextRotationIndex(dir, base);
  const rotatedPath = path.join(dir, `${base}.${nextIndex}.jsonl`);

  await fs.rename(auditPath, rotatedPath);
  await writeFloorMarker(rotatedPath);

  const newFd = await fs.open(auditPath, 'a');
  return { rotated: true, fd: newFd, newSize: 0, rotatedPath };
}

async function nextRotationIndex(dir: string, base: string): Promise<number> {
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const pattern = new RegExp(`^${base}\\.(\\d+)\\.jsonl$`);
  let max = 0;
  for (const entry of entries) {
    const match = pattern.exec(entry);
    if (match) {
      const idx = Number.parseInt(match[1] ?? '0', 10);
      if (Number.isFinite(idx) && idx > max) max = idx;
    }
  }
  return max + 1;
}

async function writeFloorMarker(rotatedPath: string): Promise<void> {
  const markerPath = `${rotatedPath}.floor.marker`;
  const payload = JSON.stringify({
    rotatedAt: Date.now(),
    source: path.basename(rotatedPath),
  }) + '\n';
  await fs.writeFile(markerPath, payload, { encoding: 'utf8' });
}
