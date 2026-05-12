/**
 * ADR-0177 Phase 1.6 (c): RVF backends read substrate-wide dimension from the
 * config chain when caller did not specify one. Dimension stays locked for the
 * life of the RVF segment (ADR-0175). Explicit constructor args still win.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock @ruvector/rvf so we can capture what dimension RvfDatabase.create receives
const mockDb = {
  status: vi.fn().mockResolvedValue({ totalVectors: 0, totalSegments: 0 }),
  close: vi.fn().mockResolvedValue(undefined),
  ingestBatch: vi.fn().mockResolvedValue({ accepted: 0, rejected: 0, epoch: 1 }),
};

const mockCreateFn = vi.fn().mockResolvedValue(mockDb);
const mockOpenFn = vi.fn().mockResolvedValue(mockDb);

vi.mock('@ruvector/rvf', () => ({
  RvfDatabase: {
    create: (...args: unknown[]) => mockCreateFn(...args),
    open: (...args: unknown[]) => mockOpenFn(...args),
  },
}));

import { RvfBackend } from '../../src/backends/rvf/RvfBackend.js';
import { resetConfig } from '../../src/core/config-chain.js';

let prevCwd: string;
let scratchDir: string;

function makeScratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentdb-rvf-cc-'));
}

function writeEmbeddingsJson(dir: string, body: object): void {
  const claudeFlow = path.join(dir, '.claude-flow');
  fs.mkdirSync(claudeFlow, { recursive: true });
  fs.writeFileSync(path.join(claudeFlow, 'embeddings.json'), JSON.stringify(body));
}

beforeEach(() => {
  prevCwd = process.cwd();
  scratchDir = makeScratch();
  process.chdir(scratchDir);
  resetConfig();
  mockCreateFn.mockClear();
});

afterEach(() => {
  process.chdir(prevCwd);
  resetConfig();
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('RvfBackend dimension from config chain', () => {
  it('uses dimension from .claude-flow/embeddings.json when constructor omits it', async () => {
    writeEmbeddingsJson(scratchDir, {
      model: 'Xenova/all-mpnet-base-v2',
      dimension: 768,
      provider: 'onnx',
    });
    // @ts-expect-error -- intentionally constructing without dimension
    const backend = new RvfBackend({ metric: 'cosine', storagePath: ':memory:' });
    await backend.initialize();
    expect(mockCreateFn).toHaveBeenCalledOnce();
    const [, createOpts] = mockCreateFn.mock.calls[0] as [string, { dimensions: number }];
    expect(createOpts.dimensions).toBe(768);
  });

  it('explicit constructor dimension wins over config chain', async () => {
    writeEmbeddingsJson(scratchDir, {
      model: 'Xenova/all-mpnet-base-v2',
      dimension: 768,
      provider: 'onnx',
    });
    const backend = new RvfBackend({ dimension: 384, metric: 'cosine', storagePath: ':memory:' });
    await backend.initialize();
    const [, createOpts] = mockCreateFn.mock.calls[0] as [string, { dimensions: number }];
    expect(createOpts.dimensions).toBe(384);
  });

  it('falls back to hardcoded default when no config file exists', async () => {
    // @ts-expect-error -- intentionally constructing without dimension
    const backend = new RvfBackend({ metric: 'cosine', storagePath: ':memory:' });
    await backend.initialize();
    const [, createOpts] = mockCreateFn.mock.calls[0] as [string, { dimensions: number }];
    expect(createOpts.dimensions).toBe(768);
  });

  it('reports config-chain dimension via getStats', () => {
    writeEmbeddingsJson(scratchDir, {
      model: 'BAAI/bge-small-en-v1.5',
      dimension: 384,
      provider: 'onnx',
    });
    // @ts-expect-error -- intentionally constructing without dimension
    const backend = new RvfBackend({ metric: 'cosine', storagePath: ':memory:' });
    expect(backend.getStats().dimension).toBe(384);
  });
});

describe('SelfLearningRvfBackend dimension flow', () => {
  it('inherits dimension from config chain via parent RvfBackend', async () => {
    writeEmbeddingsJson(scratchDir, {
      model: 'Xenova/all-mpnet-base-v2',
      dimension: 768,
      provider: 'onnx',
    });
    const { SelfLearningRvfBackend } = await import('../../src/backends/rvf/SelfLearningRvfBackend.js');
    // Disable learning so we don't pull in @ruvector/sona etc. in the unit run
    const instance = await SelfLearningRvfBackend.create({
      metric: 'cosine',
      storagePath: ':memory:',
      learning: false,
    });
    // Both the inner RvfBackend and the wrapper must agree
    expect(instance.getBackend().getStats().dimension).toBe(768);
    instance.destroy();
  });
});
