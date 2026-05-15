// charter: substrate-seam
// ADR-0181 Phase 1 — initialize(config) feeding behavioral spec.
//
// Phase 1 makes each host process (cli, ruflo daemon, hook-handler) construct
// its OWN per-process Archivist and feed it a projectRoot-only
// ArchivistInitConfig. This test is the behavioral spec for that config: it
// asserts a projectRoot-only init is (a) REAL — FS-JSON substrates resolve and
// thread through the supplied projectRoot — and (b) HONEST — RVF / SQLite
// carve-out substrates fail loud rather than silently no-op, because Phase 1
// deliberately wires no rvfBackend / sqliteDb (deferred to the phase that
// un-stubs the handlers dispatching through them).
//
// "init-completion, not registry non-emptiness" is the ADR-0181 Phase 1
// exit-gate invariant: initialize() eagerly builds only the substrate families
// whose backend the config supplies — FS-JSON is lazy-minted on demand — so a
// projectRoot-only config legitimately leaves the eager registry empty. What
// must hold is that initialize() COMPLETES and the lazy FS-JSON path works.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Archivist, type StoreId } from '../../src/archivist/index.js';

function freshProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'adr0181-p1-'));
  // FS-JSON substrates live under <projectRoot>/.claude-flow/ — make it exist
  // so substrate construction never races a missing parent.
  mkdirSync(join(root, '.claude-flow'), { recursive: true });
  return root;
}

describe('ADR-0181 Phase 1 — Archivist.initialize() projectRoot-only config feeding', () => {
  it('initialize({ projectRoot }) completes and is idempotent', async () => {
    const projectRoot = freshProjectRoot();
    const archivist = new Archivist();

    await expect(archivist.initialize({ projectRoot })).resolves.toBeUndefined();
    // Idempotent — `if (this.initialized) return` — a second call is a no-op.
    await expect(archivist.initialize({ projectRoot })).resolves.toBeUndefined();
  });

  it('an FS-JSON store resolves through the supplied projectRoot (config is REAL)', async () => {
    const projectRoot = freshProjectRoot();
    const archivist = new Archivist();
    await archivist.initialize({ projectRoot });

    // `tasks` is in neither the RVF nor the SQLite-carve-out roster → it
    // classifies as fs-json → lazily minted from projectRoot. A projectRoot-only
    // config MUST make this resolve, not throw.
    const substrate = archivist.getSubstrate('tasks' as StoreId);
    expect(substrate).toBeDefined();
  });

  it('an RVF store fails loud — projectRoot-only wires no rvfBackend (config is HONEST)', async () => {
    const projectRoot = freshProjectRoot();
    const archivist = new Archivist();
    await archivist.initialize({ projectRoot });

    // `memory_store` classifies as rvf. Phase 1's projectRoot-only config
    // supplies no rvfBackend, so getSubstrate() MUST throw — never return a
    // silent no-op substrate (feedback-no-fallbacks).
    expect(() => archivist.getSubstrate('memory_store' as StoreId)).toThrow(/rvfBackend/i);
  });

  it('a SQLite carve-out store fails loud — projectRoot-only wires no sqliteDb', async () => {
    const projectRoot = freshProjectRoot();
    const archivist = new Archivist();
    await archivist.initialize({ projectRoot });

    // `agentdb_causal_recall` classifies as the SQLite carve-out (ADR-0166).
    // projectRoot-only supplies no sqliteDb → getSubstrate() MUST throw.
    expect(() => archivist.getSubstrate('agentdb_causal_recall' as StoreId)).toThrow(/sqliteDb/i);
  });
});
