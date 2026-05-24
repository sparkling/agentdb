/**
 * ADR-0246 F-03-002 path (b) — RVF staging enforcement.
 *
 * Extends Batch 1's FS-JSON staging (path a) to the RVF substrate. The
 * staging substrate intercepts `handle.rvf.insertAsync` / `removeAsync` /
 * `insertBatchAsync` calls during the dispatch, journals them in memory,
 * and replays through the real backend on `commit()`. On invariant
 * violation, `rollback()` discards the journal — nothing reaches the
 * `.rvf` file.
 *
 * Test approach:
 *   - Real `SqlJsRvfBackend` at a temp path (always-available built-in
 *     per F-03-001 test precedent — `@ruvector/rvf` is optional).
 *   - Real `Archivist` initialized with the RVF backend.
 *   - Custom mutation handler + invariant registered for the test —
 *     the handler does `await rvfHandle.rvf.insertAsync(...)`; the
 *     invariant always rejects.
 *   - Assert:
 *       (i) dispatch throws with the invariant violation.
 *       (ii) reopening the same RVF backend shows the count is zero
 *            (nothing reached the .rvf file).
 *
 * Per ADR-0246 §"Test discipline tightened" — real substrate, NOT a mock.
 * Per Expert 4 (swarm review) — no in-memory mock substrates.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Archivist } from '../../src/archivist/index.js';
import { __resetRegistry__, registerMutationHandler } from '../../src/archivist/registration.js';
import { SqlJsRvfBackend } from '../../src/backends/rvf/SqlJsRvfBackend.js';

const DIM = 4;
const TEST_TOOL = 'memory_store';

let scratchDir;
let storePath;

beforeEach(() => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr0246-f03002b-rvf-'));
  storePath = path.join(scratchDir, 'staging-test.rvf');
  __resetRegistry__();
});

afterEach(() => {
  __resetRegistry__();
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('ADR-0246 F-03-002 path (b): RVF staging enforcement', () => {
  it('invariant violation does NOT leave the insert on disk', async () => {
    // ── Phase 1: register a test handler that does an RVF insert ──
    // The invariant ALWAYS rejects so we exercise the rollback path.
    registerMutationHandler(
      TEST_TOOL,
      async (ctx, payload) => {
        await ctx.substrate.withWrite({ storeId: 'memory_store' }, async (handle) => {
          // The staging substrate's handle.rvf is a recording proxy; the
          // call is journaled, not committed.
          const rvfHandle = handle;
          const embedding = new Float32Array(DIM).fill(0.5);
          await rvfHandle.rvf.insertAsync(payload.id, embedding, { tag: payload.tag });
        });
      },
      {
        invariants: [
          // Always-rejecting invariant — simulates the F-03-002 repro shape.
          () => ({ violated: true, detail: 'test invariant always rejects (ADR-0246 F-03-002 path b)' }),
        ],
      },
    );

    // ── Phase 2: bring up the RVF backend and the archivist ──
    const backend = new SqlJsRvfBackend({
      dimension: DIM,
      metric: 'cosine',
      storagePath: storePath,
    });
    await backend.initialize();
    await backend.save(storePath);

    const archivist = new Archivist();
    await archivist.initialize({
      projectRoot: scratchDir,
      rvfBackend: backend,
    });

    // ── Phase 3: dispatch — must throw because the invariant rejects ──
    await expect(
      archivist.dispatch(TEST_TOOL, { id: 'should-not-persist', tag: 'invariant-violator' }),
    ).rejects.toThrow(/test invariant always rejects/);

    // ── Phase 4: prove the insert never reached the backend ──
    // The backend's cached count should be 0 — no insertAsync ever
    // touched the real `db.ingestBatch` because the staging substrate
    // journals and the rollback path discards.
    const stats = await backend.getStatsAsync();
    expect(stats.count).toBe(0);

    // Cross-check: close + reopen the backend from disk; the persisted
    // state should likewise show zero entries.
    backend.close();
    const reopened = new SqlJsRvfBackend({
      dimension: DIM,
      metric: 'cosine',
      storagePath: storePath,
    });
    await reopened.initialize();
    const reopenedStats = await reopened.getStatsAsync();
    expect(reopenedStats.count).toBe(0);
    reopened.close();
  });

  it('passing invariants commit the staged insert through to disk', async () => {
    // Mirror test asserting the happy path still commits — staging must
    // not regress the existing pass-through behavior.
    registerMutationHandler(
      TEST_TOOL,
      async (ctx, payload) => {
        await ctx.substrate.withWrite({ storeId: 'memory_store' }, async (handle) => {
          const rvfHandle = handle;
          const embedding = new Float32Array(DIM).fill(0.5);
          await rvfHandle.rvf.insertAsync(payload.id, embedding, { tag: payload.tag });
        });
      },
      {
        invariants: [() => 'pass'],
      },
    );

    const backend = new SqlJsRvfBackend({
      dimension: DIM,
      metric: 'cosine',
      storagePath: storePath,
    });
    await backend.initialize();
    await backend.save(storePath);

    const archivist = new Archivist();
    await archivist.initialize({
      projectRoot: scratchDir,
      rvfBackend: backend,
    });

    await archivist.dispatch(TEST_TOOL, { id: 'should-persist', tag: 'happy-path' });

    const stats = await backend.getStatsAsync();
    expect(stats.count).toBe(1);
    backend.close();
  });

  it('handler throw also rolls back the staged insert', async () => {
    // The dispatch path's catch arm calls staging.rollback() so a handler
    // that throws AFTER the insert call (but BEFORE returning) does not
    // commit the staged work either.
    registerMutationHandler(
      TEST_TOOL,
      async (ctx, payload) => {
        await ctx.substrate.withWrite({ storeId: 'memory_store' }, async (handle) => {
          const rvfHandle = handle;
          const embedding = new Float32Array(DIM).fill(0.5);
          await rvfHandle.rvf.insertAsync(payload.id, embedding, { tag: payload.tag });
          // Then throw — the staged insert must not commit.
          throw new Error('handler-throw-after-insert');
        });
      },
      {
        invariants: [() => 'pass'],
      },
    );

    const backend = new SqlJsRvfBackend({
      dimension: DIM,
      metric: 'cosine',
      storagePath: storePath,
    });
    await backend.initialize();
    await backend.save(storePath);

    const archivist = new Archivist();
    await archivist.initialize({
      projectRoot: scratchDir,
      rvfBackend: backend,
    });

    await expect(
      archivist.dispatch(TEST_TOOL, { id: 'should-not-persist-on-throw', tag: 'throw-path' }),
    ).rejects.toThrow(/handler-throw-after-insert/);

    const stats = await backend.getStatsAsync();
    expect(stats.count).toBe(0);
    backend.close();
  });
});
