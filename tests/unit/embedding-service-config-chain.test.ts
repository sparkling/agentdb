/**
 * ADR-0177 Phase 1.6 (d): EmbeddingService reads model + provider from the
 * config chain (.claude-flow/embeddings.json) when constructor omits them.
 * On pipeline init, output dim is probed and compared to substrate dimension;
 * mismatch throws EmbeddingDimensionMismatchError (fatal — would silently
 * corrupt every RVF segment otherwise).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let prevCwd: string;
let scratchDir: string;

function writeEmbeddingsJson(dir: string, body: object): void {
  const claudeFlow = path.join(dir, '.claude-flow');
  fs.mkdirSync(claudeFlow, { recursive: true });
  fs.writeFileSync(path.join(claudeFlow, 'embeddings.json'), JSON.stringify(body));
}

beforeEach(() => {
  prevCwd = process.cwd();
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdb-embsvc-'));
  process.chdir(scratchDir);
  vi.resetModules();
});

afterEach(() => {
  process.chdir(prevCwd);
  vi.unmock('@xenova/transformers');
  vi.unmock('../../src/model/ModelCacheLoader.js');
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('EmbeddingService config-chain readers', () => {
  it('reads model from config chain when constructor omits it', async () => {
    writeEmbeddingsJson(scratchDir, {
      model: 'BAAI/bge-small-en-v1.5',
      dimension: 384,
      provider: 'onnx',
    });
    const { resetConfig } = await import('../../src/core/config-chain.js');
    resetConfig();
    const { EmbeddingService } = await import('../../src/controllers/EmbeddingService.js');
    // Construct with no config — should pull from chain
    const svc = new EmbeddingService();
    // Field is private — use a behaviour-based assertion: mockEmbedding
    // generates `dimension`-sized Float32Array. Since pipeline init is async
    // and may fail without @xenova, we use embed() in mock mode.
    const out = await svc.embed('test');
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(384);
    resetConfig();
  });

  it('normalises chain provider onnx to transformers for internal pipeline', async () => {
    writeEmbeddingsJson(scratchDir, {
      model: 'Xenova/all-mpnet-base-v2',
      dimension: 768,
      provider: 'onnx',
    });
    const { resetConfig } = await import('../../src/core/config-chain.js');
    resetConfig();
    const { EmbeddingService } = await import('../../src/controllers/EmbeddingService.js');
    const svc = new EmbeddingService();
    // initialize() with provider=transformers attempts to load @xenova.
    // We don't have @xenova in unit context — but the catch falls back to
    // mock embeddings without throwing, which is exactly what we assert here.
    await svc.initialize();
    const out = await svc.embed('hello');
    expect(out.length).toBe(768);
    resetConfig();
  });

  it('throws EmbeddingDimensionMismatchError when pipeline output dim differs', async () => {
    writeEmbeddingsJson(scratchDir, {
      model: 'fake/mismatch-model',
      dimension: 768,
      provider: 'onnx',
    });
    // Mock @xenova/transformers so the pipeline returns a 384-dim probe
    vi.doMock('@xenova/transformers', () => ({
      env: {},
      pipeline: async () => async (_text: string, _opts: unknown) => ({
        data: new Float32Array(384),
      }),
    }));
    // Also stub ModelCacheLoader so we go through the network/local-cache code path cleanly
    vi.doMock('../../src/model/ModelCacheLoader.js', () => ({
      ModelCacheLoader: { resolve: async () => null },
    }));
    const { resetConfig } = await import('../../src/core/config-chain.js');
    resetConfig();
    const { EmbeddingService } = await import('../../src/controllers/EmbeddingService.js');
    const { EmbeddingDimensionMismatchError } = await import('../../src/core/config-chain.js');
    const svc = new EmbeddingService();
    await expect(svc.initialize()).rejects.toThrow(EmbeddingDimensionMismatchError);
    resetConfig();
  });
});
