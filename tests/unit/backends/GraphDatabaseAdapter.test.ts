/**
 * Unit Tests for GraphDatabaseAdapter — ADR-0221
 *
 * Verifies that initialize() discriminates "file absent" (create fresh DB)
 * from "file present but corrupt" (throw GraphDatabaseCorruptError), and that
 * the outer catch does NOT re-wrap GraphDatabaseCorruptError into the generic
 * "Failed to initialize RuVector Graph Database" error.
 *
 * Path 1 (vi.mock at module scope): vi.mock('@ruvector/graph-node', factory)
 * is hoisted before any import resolves, so the real initialize() runs its
 * real dynamic import and receives the mock module.  The real source logic is
 * exercised on every test — no prototype overrides, no golden-master theatre.
 *
 * (fix-forward: replace test theatre with real-initialize() exercise — ADR-0221)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GraphDatabaseAdapter, GraphDatabaseCorruptError } from '../../../src/backends/graph/GraphDatabaseAdapter.js';
import { EmbeddingService } from '../../../src/controllers/EmbeddingService.js';

// ---------------------------------------------------------------------------
// Module-scope mock — MUST be declared before any dynamic import inside the
// source runs.  vi.mock is hoisted to the top of the compiled output by the
// vitest transform, so the factory runs before the first test even starts.
//
// mockOpen is a module-level vi.fn() that each test configures to control
// what GraphDatabase.open() returns or throws.
// ---------------------------------------------------------------------------

const mockOpen = vi.fn();
const mockConstructed = vi.fn();

vi.mock('@ruvector/graph-node', () => {
  class MockGraphDatabase {
    static open(storagePath: string): MockGraphDatabase {
      // Delegates to the per-test-configurable spy.
      return mockOpen(storagePath);
    }
    constructor(config?: any) {
      mockConstructed(config);
    }
  }
  return { GraphDatabase: MockGraphDatabase };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpPath(): string {
  return path.join(os.tmpdir(), `agentdb-graph-test-${Math.random().toString(36).slice(2)}.db`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphDatabaseAdapter — ADR-0221 discriminate corrupt vs absent', () => {
  let embedder: EmbeddingService;
  let createdPaths: string[] = [];

  beforeEach(async () => {
    embedder = new EmbeddingService({
      model: 'mock-model',
      dimension: 384,
      provider: 'local',
    });
    await embedder.initialize();
    createdPaths = [];
    // Vitest's global clearMocks:true resets call counts; reset implementation
    // explicitly so each test starts from a clean slate.
    mockOpen.mockReset();
    mockConstructed.mockReset();
  });

  afterEach(() => {
    for (const p of createdPaths) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
  });

  it('should throw GraphDatabaseCorruptError when the DB file exists but open() fails', async () => {
    // Arrange: create a file (corrupt-looking placeholder) at storagePath.
    const dbPath = tmpPath();
    createdPaths.push(dbPath);
    fs.writeFileSync(dbPath, 'not a valid graph database');

    // Configure mock: open() throws, simulating a corrupt file.
    const corruptErr = new Error('mock: corrupt database');
    mockOpen.mockImplementation(() => { throw corruptErr; });

    const adapter = new GraphDatabaseAdapter({ storagePath: dbPath }, embedder);

    // The REAL initialize() runs here — no prototype override.
    await expect(adapter.initialize()).rejects.toBeInstanceOf(GraphDatabaseCorruptError);
  });

  it('GraphDatabaseCorruptError message should include storagePath and a recovery hint', async () => {
    const dbPath = tmpPath();
    createdPaths.push(dbPath);
    fs.writeFileSync(dbPath, 'corrupted bytes');

    mockOpen.mockImplementation(() => { throw new Error('mock: corrupt database'); });

    const adapter = new GraphDatabaseAdapter({ storagePath: dbPath }, embedder);

    // The REAL initialize() runs here.
    const err = await adapter.initialize().catch(e => e);
    expect(err).toBeInstanceOf(GraphDatabaseCorruptError);
    expect(err.message).toContain(dbPath);
    expect(err.message).toContain('Refusing to silently replace');
  });

  it('should create a fresh DB (not throw) when no file exists at storagePath', async () => {
    // dbPath does NOT exist on disk — file-absent first-boot path.
    const dbPath = tmpPath();

    // open() should never be called for an absent file; constructor succeeds.
    mockOpen.mockImplementation(() => { throw new Error('should not be called'); });
    mockConstructed.mockReturnValue(undefined);

    const adapter = new GraphDatabaseAdapter({ storagePath: dbPath }, embedder);

    // The REAL initialize() runs here.
    await expect(adapter.initialize()).resolves.toBeUndefined();

    // Confirm open() was NOT called (no file present) and constructor WAS called.
    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockConstructed).toHaveBeenCalledOnce();
  });

  it('GraphDatabaseCorruptError is not re-wrapped by the outer catch (type preserved)', async () => {
    // Tests the outer-catch passthrough added by ADR-0221:
    // When initialize() throws a GraphDatabaseCorruptError (from the inner
    // discriminate block), the outer catch MUST pass it through without
    // re-wrapping it into the generic "Failed to initialize RuVector Graph
    // Database" error.
    //
    // The inner discriminate block (lines 149-166 of the source) wraps any
    // open() failure into a fresh GraphDatabaseCorruptError.  The outer catch
    // must see that and re-throw it unchanged.  We verify this by checking:
    //   (a) the error is a GraphDatabaseCorruptError, and
    //   (b) its message does NOT contain the generic wrapper string that the
    //       outer catch would produce if it didn't discriminate.
    const dbPath = tmpPath();
    createdPaths.push(dbPath);
    fs.writeFileSync(dbPath, 'corrupt');

    // open() throws a plain Error — the inner discriminate block will wrap it
    // into a GraphDatabaseCorruptError.  The outer catch must then pass THAT
    // GraphDatabaseCorruptError through, not re-wrap it again.
    mockOpen.mockImplementation(() => { throw new Error('native: invalid data'); });

    const adapter = new GraphDatabaseAdapter({ storagePath: dbPath }, embedder);

    // The REAL initialize() runs here.
    const err = await adapter.initialize().catch(e => e);

    // Must be a GraphDatabaseCorruptError (not a generic Error).
    expect(err).toBeInstanceOf(GraphDatabaseCorruptError);

    // Must NOT be re-wrapped into the generic outer-catch message.
    expect(err.message).not.toContain('Failed to initialize RuVector Graph Database');

    // Must carry the inner discriminate message with the path and recovery hint.
    expect(err.message).toContain(dbPath);
    expect(err.message).toContain('Refusing to silently replace');
  });
});
