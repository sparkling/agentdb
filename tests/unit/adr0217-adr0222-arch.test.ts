/**
 * Arch-tests for ADR-0217 (QUIC quarantine) and ADR-0222 (federated-learning deletion).
 *
 * These tests act as trip-wires: they fail immediately if the quarantine or
 * deletion is accidentally reversed.
 *
 * Self-mutation contract:
 *   - Re-adding QUICConnectionPool.ts or QUICStreamManager.ts to
 *     src/controllers/ → "QUIC pool/stream files must not exist" tests go RED.
 *   - Re-exporting resolveConflicts from src/index.ts → the "resolveConflicts
 *     must not be in public exports" test goes RED.
 *   - Restoring src/services/federated-learning.ts → "federated-learning file
 *     must not exist" test goes RED.
 *   - Removing VectorClock/incrementVectorClock/createVectorClock from
 *     src/index.ts exports → "agentic-flow consumer exports must still be
 *     present" tests go RED.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(import.meta.dirname ?? __dirname, '../../src');

// ---------------------------------------------------------------------------
// ADR-0217: QUIC quarantine
// ---------------------------------------------------------------------------

describe('ADR-0217 QUIC quarantine', () => {
  it('QUICConnectionPool file must not exist in controllers/', () => {
    const path = resolve(SRC, 'controllers/QUICConnectionPool.ts');
    expect(existsSync(path), `${path} should have been deleted`).toBe(false);
  });

  it('QUICStreamManager file must not exist in controllers/', () => {
    const path = resolve(SRC, 'controllers/QUICStreamManager.ts');
    expect(existsSync(path), `${path} should have been deleted`).toBe(false);
  });

  it('resolveConflicts must not appear in public exports of src/index.ts', async () => {
    // Dynamic import of the barrel — at this layer the compiled dist is not
    // available in unit tests, so we inspect the source text directly.
    const { readFileSync } = await import('node:fs');
    const indexSrc = readFileSync(resolve(SRC, 'index.ts'), 'utf-8');
    // The export must NOT appear without a comment marker
    const lines = indexSrc.split('\n');
    const exportLines = lines.filter(
      l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*') && l.includes('resolveConflicts')
    );
    expect(exportLines, 'resolveConflicts must not appear in live export lines').toHaveLength(0);
  });

  it('conflictStrategy must be marked @deprecated in SyncCoordinatorConfig', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(resolve(SRC, 'controllers/SyncCoordinator.ts'), 'utf-8');
    expect(src).toContain('@deprecated — dead path');
  });

  it('resolveConflicts method must be marked @deprecated in SyncCoordinator.ts', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(resolve(SRC, 'controllers/SyncCoordinator.ts'), 'utf-8');
    // The resolveConflicts JSDoc must contain @deprecated
    const idx = src.indexOf('private async resolveConflicts');
    expect(idx).toBeGreaterThan(-1);
    const jsdocRegion = src.slice(Math.max(0, idx - 800), idx);
    expect(jsdocRegion).toContain('@deprecated');
  });

  it('quicPush must throw immediately (fail-loud guard present)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(resolve(SRC, 'cli/agentdb-cli.ts'), 'utf-8');
    // The guard throw must appear before the log.header inside quicPush
    const pushIdx = src.indexOf('async quicPush(');
    expect(pushIdx).toBeGreaterThan(-1);
    const pushBody = src.slice(pushIdx, pushIdx + 1200);
    // Filter to non-comment lines so that commenting out the live throw stays RED
    const liveLines = pushBody.split('\n').filter(
      l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*')
    );
    const liveText = liveLines.join('\n');
    expect(liveText).toContain('throw new Error(');
    expect(liveText).toContain('ADR-0217');
  });

  it('quicPull must throw immediately (fail-loud guard present)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(resolve(SRC, 'cli/agentdb-cli.ts'), 'utf-8');
    const pullIdx = src.indexOf('async quicPull(');
    expect(pullIdx).toBeGreaterThan(-1);
    const pullBody = src.slice(pullIdx, pullIdx + 1200);
    // Filter to non-comment lines so that commenting out the live throw stays RED
    const liveLines = pullBody.split('\n').filter(
      l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*')
    );
    const liveText = liveLines.join('\n');
    expect(liveText).toContain('throw new Error(');
    expect(liveText).toContain('ADR-0217');
  });

  // -------------------------------------------------------------------------
  // HIGHEST-SEVERITY TRAP: agentic-flow VectorClock consumer must stay green
  // -------------------------------------------------------------------------

  it('VectorClock type must still be exported from src/index.ts', async () => {
    const { readFileSync } = await import('node:fs');
    const indexSrc = readFileSync(resolve(SRC, 'index.ts'), 'utf-8');
    // Must appear as a live export (not only in a comment), matched as a
    // whole word so VectorClockComparison does not satisfy the check.
    const lines = indexSrc.split('\n');
    const liveLines = lines.filter(
      l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*') && /\bVectorClock\b/.test(l)
    );
    expect(liveLines.length, 'VectorClock must appear in live export lines').toBeGreaterThan(0);
  });

  it('incrementVectorClock must still be exported from src/index.ts', async () => {
    const { readFileSync } = await import('node:fs');
    const indexSrc = readFileSync(resolve(SRC, 'index.ts'), 'utf-8');
    // Must appear as a live export (not only in a comment)
    const lines = indexSrc.split('\n');
    const liveLines = lines.filter(
      l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*') && l.includes('incrementVectorClock')
    );
    expect(liveLines.length, 'incrementVectorClock must appear in live export lines').toBeGreaterThan(0);
  });

  it('createVectorClock must still be exported from src/index.ts', async () => {
    const { readFileSync } = await import('node:fs');
    const indexSrc = readFileSync(resolve(SRC, 'index.ts'), 'utf-8');
    const lines = indexSrc.split('\n');
    const liveLines = lines.filter(
      l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*') && l.includes('createVectorClock')
    );
    expect(liveLines.length, 'createVectorClock must appear in live export lines').toBeGreaterThan(0);
  });

  it('src/types/quic.ts must mark VectorClock as @public (agentic-flow exception)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(resolve(SRC, 'types/quic.ts'), 'utf-8');
    expect(src).toContain('@public — retained');
  });
});

// ---------------------------------------------------------------------------
// ADR-0222: federated-learning deletion
// ---------------------------------------------------------------------------

describe('ADR-0222 federated-learning deletion', () => {
  it('src/services/federated-learning.ts must not exist', () => {
    const path = resolve(SRC, 'services/federated-learning.ts');
    expect(existsSync(path), `${path} should have been deleted`).toBe(false);
  });

  it('FederatedLearningManager must not appear in agentdb src/ (outside deleted file)', async () => {
    // Use a simple grep-like scan to ensure nothing re-imports the deleted class
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const banned = ['FederatedLearningManager', 'FederatedLearningCoordinator', 'EphemeralLearningAgent'];

    function walk(dir: string): string[] {
      const results: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry);
        if (entry === 'node_modules' || entry === 'dist') continue;
        const stat = statSync(full);
        if (stat.isDirectory()) results.push(...walk(full));
        else if (full.endsWith('.ts')) results.push(full);
      }
      return results;
    }

    const tsFiles = walk(SRC);
    const violations: string[] = [];
    for (const file of tsFiles) {
      const content = readFileSync(file, 'utf-8');
      for (const symbol of banned) {
        if (content.includes(symbol)) {
          violations.push(`${file}: contains ${symbol}`);
        }
      }
    }
    expect(violations, `These files must not reference deleted federated-learning symbols:\n${violations.join('\n')}`).toHaveLength(0);
  });
});
