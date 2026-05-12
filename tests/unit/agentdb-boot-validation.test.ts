/**
 * ADR-0177 Phase 1.6 (e): AgentDB.initialize() boot validation.
 *
 * Throws ConfigChainValidationError for:
 *   - paid provider when allowPaidProvider=false (feedback-no-api-keys)
 *   - embedding.model missing when an on-disk embeddings.json is present
 *
 * Per Amendment 2 (2026-05-12): does NOT validate @xenova availability.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentDB } from '../../src/core/AgentDB.js';
import { ConfigChainValidationError, resetConfig } from '../../src/core/config-chain.js';

let prevCwd: string;
let scratchDir: string;

function writeEmbeddingsJson(dir: string, body: object): void {
  const claudeFlow = path.join(dir, '.claude-flow');
  fs.mkdirSync(claudeFlow, { recursive: true });
  fs.writeFileSync(path.join(claudeFlow, 'embeddings.json'), JSON.stringify(body));
}

beforeEach(() => {
  prevCwd = process.cwd();
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdb-boot-'));
  process.chdir(scratchDir);
  resetConfig();
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

describe('AgentDB.initialize() boot validation', () => {
  it('throws ConfigChainValidationError for paid provider with allowPaidProvider=false', async () => {
    writeEmbeddingsJson(scratchDir, {
      model: 'text-embedding-3-small',
      dimension: 1536,
      provider: 'openai',
      allowPaidProvider: false,
    });
    const db = new AgentDB({ dbPath: ':memory:' });
    await expect(db.initialize()).rejects.toThrow(ConfigChainValidationError);
  });

  it('throws ConfigChainValidationError when embeddings.json exists but model is empty', async () => {
    writeEmbeddingsJson(scratchDir, {
      model: '',
      dimension: 768,
      provider: 'onnx',
      allowPaidProvider: false,
    });
    const db = new AgentDB({ dbPath: ':memory:' });
    await expect(db.initialize()).rejects.toThrow(ConfigChainValidationError);
  });

  // Note: a positive-path initialize() test requires the full database stack
  // (better-sqlite3 or sql.js WASM + schemas + EmbeddingService pipeline) and
  // is covered by the integration suite in tests/integration/. Validating that
  // initialize() does not throw ConfigChainValidationError specifically — and
  // any downstream failure (network/wasm) is not part of Phase 1.6 (e).
  it('does not throw ConfigChainValidationError for valid onnx config', async () => {
    writeEmbeddingsJson(scratchDir, {
      model: 'Xenova/all-mpnet-base-v2',
      dimension: 768,
      provider: 'onnx',
      allowPaidProvider: false,
    });
    const db = new AgentDB({ dbPath: ':memory:' });
    // The init may still fail downstream (e.g. no transformers.js pipeline) but
    // it must NOT fail with ConfigChainValidationError. We assert by catching
    // and inspecting the error type, allowing any non-validation error through.
    let validationErr: ConfigChainValidationError | null = null;
    try {
      await db.initialize();
    } catch (err) {
      if (err instanceof ConfigChainValidationError) validationErr = err;
    }
    expect(validationErr).toBeNull();
  });
});
