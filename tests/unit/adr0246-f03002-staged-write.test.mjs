/**
 * ADR-0246 F-03-002 — Archivist staged-write for FS-JSON substrate.
 *
 * Red-first test: dispatches `ruvllm_microlora_adapt` with an all-zero input,
 * which is rejected by the `inputIsNotAllZero` invariant (ADR-0231 Wave 2).
 * Asserts:
 *
 *   (i) the dispatch throws (current pre-fix behaviour passes this)
 *   (ii) `handle.read()` after the throw does NOT contain a zero-input
 *        journal entry (current pre-fix behaviour FAILS this — the
 *        substrate is committed before invariants run)
 *
 * Per ADR-0246 §"Test discipline tightened" — exercises a REAL FS-JSON
 * substrate at a temp path via the archivist's own `projectRoot`-driven
 * routing (`fsJsonPathFor(projectRoot, 'ruvllm_microlora')` →
 * `<projectRoot>/.claude-flow/ruvllm/microlora-store.json`), NOT a mock.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Archivist } from '../../src/archivist/index.js';

// Wire the microlora-adapt handler under test by importing its module
// side-effect (registers the GuardedWrite under name `ruvllm_microlora_adapt`).
import '../../src/archivist/handlers/ruvllm/microlora-adapt.js';

const INPUT_DIM = 4;

let scratchDir;
let storePath;

beforeEach(() => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr0246-f03002-'));
  storePath = path.join(scratchDir, '.claude-flow', 'ruvllm', 'microlora-store.json');
  fs.mkdirSync(path.dirname(storePath), { recursive: true });

  // Seed the FS-JSON file with a single MicroLoRA instance that has the
  // expected inputDim so the handler's dim-check passes and we reach the
  // invariant boundary.
  const seedDoc = {
    version: '1.0.0',
    instances: {
      'lora-a': {
        id: 'lora-a',
        createdAt: new Date().toISOString(),
        config: { inputDim: INPUT_DIM, outputDim: 4 },
        journal: [],
      },
    },
  };
  fs.writeFileSync(storePath, JSON.stringify(seedDoc, null, 2));
});

afterEach(() => {
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('ADR-0246 F-03-002: staged FS-JSON writes; invariants run pre-commit', () => {
  it('all-zero input invariant violation does NOT leave a zero entry on disk', async () => {
    const archivist = new Archivist();
    await archivist.initialize({ projectRoot: scratchDir });

    // Dispatch with an all-zero input — the invariant must reject AND the
    // substrate must not retain the zero entry.
    const allZeroInput = new Array(INPUT_DIM).fill(0);

    await expect(
      archivist.dispatch('ruvllm_microlora_adapt', {
        loraId: 'lora-a',
        input: allZeroInput,
        quality: 0.5,
      }),
    ).rejects.toThrow(/inputIsNotAllZero|invariant|input vector is all-zero/i);

    // After the throw, reload the FS-JSON document. The journal MUST NOT
    // contain a `{op:'adapt', input:[0,0,0,0], ...}` entry — that would be
    // the pre-fix bug (substrate written before invariants).
    const raw = fs.readFileSync(storePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const journal = parsed.instances['lora-a'].journal;
    expect(journal.length).toBe(0);
  });
});
