/**
 * ADR-0289 — PII/secret redaction before durable capture.
 *
 * Unit contract for `src/security/redaction.ts` + the `storeEpisode` wiring:
 *   1. SECRETS hard-block: every known-prefix family + the high-entropy
 *      catch-all throws a named `AgentDBRedactionError`; the error carries
 *      `{ kind, field }` descriptors but NEVER the matched secret value.
 *   2. PII masked by default: emails / SSN / grouped card numbers /
 *      home-directory usernames are masked BEFORE any persist or embed;
 *      structured fields are untouched; the input object is not mutated.
 *   3. Self-inert: records with no free-text are returned identically
 *      (ADR-0290 Phase-1 metadata-only episodes).
 *   4. Escape hatches: AGENTDB_REDACTION_DISABLE=1 disables the whole gate;
 *      AGENTDB_REDACTION_KEEP_PII=1 skips masking but secrets STILL block.
 *   5. Fail-loud: a detector failure surfaces as AgentDBRedactionError —
 *      raw text is never stored on an internal error (ADR-0286).
 *   6. False-positive floor: commit SHAs (pure hex) and UUIDs do NOT
 *      hard-block (entropy threshold sits above hex's 4.0 bits/char max).
 *   7. Wiring: ReflexionMemory.storeEpisode invokes the gate before any
 *      write path (source-level assertion).
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  redactFreeText,
  AgentDBRedactionError,
  EPISODE_FREE_TEXT_FIELDS,
} from '../src/security/redaction.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  delete process.env.AGENTDB_REDACTION_DISABLE;
  delete process.env.AGENTDB_REDACTION_KEEP_PII;
});

// ─── 1. secrets hard-block ──────────────────────────────────────────────

const SECRET_SAMPLES: Array<{ name: string; value: string }> = [
  { name: 'aws-access-key-id', value: 'creds AKIAIOSFODNN7EXAMPLE in task' },
  { name: 'github-token', value: 'push with ghp_aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0iL3oR6u' },
  { name: 'slack-token', value: 'xoxb-1234567890-abcdefghij' },
  { name: 'google-api-key', value: 'key AIzaSyA1bC2dE3fG4hI5jK6lM7nO8pQ9rS0tU1v' },
  { name: 'stripe-key', value: 'sk_live_a1B2c3D4e5F6g7H8' },
  { name: 'sk-prefixed-api-key', value: 'used sk-ant-api03-x7K9mQ2pL5wN8rT1 here' },
  {
    name: 'jwt',
    value:
      'auth eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N',
  },
  { name: 'bearer-token', value: 'header Bearer abcDEF123ghiJKL456mnoPQR789' },
  { name: 'pem-private-key', value: '-----BEGIN RSA PRIVATE KEY-----\nMIIE' },
  { name: 'assignment-secret', value: 'config api_key=9f8e7d6c5b4a39281706f5e4d3c2b1a0' },
  {
    name: 'high-entropy-token',
    // mixed-case + digits + symbols, 40 chars — entropy > 4.2 bits/char
    value: 'token Zq7+Xw2/Rt9-Kp4=Lm8_Vb3+Ny6/Hj1-Gf5=Ds0 leaked',
  },
];

describe('ADR-0289 §1 — secrets hard-block (named error, no leak)', () => {
  for (const { name, value } of SECRET_SAMPLES) {
    it(`blocks ${name}`, () => {
      let thrown: unknown;
      try {
        redactFreeText({ task: value, reward: 1, success: true });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(AgentDBRedactionError);
      const err = thrown as AgentDBRedactionError;
      expect(err.name).toBe('AgentDBRedactionError');
      expect(err.violations.length).toBeGreaterThan(0);
      expect(err.violations[0].field).toBe('task');
      // The error must not leak the secret content itself.
      const secretCore = value.split(/\s+/).sort((a, b) => b.length - a.length)[0];
      expect(err.message).not.toContain(secretCore);
      expect(JSON.stringify(err.violations)).not.toContain(secretCore);
    });
  }

  it('reports the offending field for non-task fields too', () => {
    try {
      redactFreeText({ task: 'safe', critique: 'leaked AKIAIOSFODNN7EXAMPLE', reward: 0, success: false });
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as AgentDBRedactionError;
      expect(err.name).toBe('AgentDBRedactionError');
      expect(err.violations.some(v => v.field === 'critique')).toBe(true);
    }
  });
});

// ─── 2. PII masking ─────────────────────────────────────────────────────

describe('ADR-0289 §2 — PII masked by default, structured untouched', () => {
  it('masks emails, SSNs, grouped card numbers, home-dir usernames', () => {
    const input = {
      task: 'email henrik@example.co.uk about 123-45-6789',
      input: 'card 4111 1111 1111 1111 on file',
      output: 'saved to /Users/henrik/notes.txt and /home/alice/x.log',
      reward: 0.5,
      success: true,
      action: 'claude-opus',
    };
    const { record, piiMasked } = redactFreeText(input);
    expect(record.task).toBe('email <redacted-email> about <redacted-id>');
    expect(record.input).toBe('card <redacted-id> on file');
    expect(record.output).toBe(
      'saved to /Users/<redacted-user>/notes.txt and /home/<redacted-user>/x.log'
    );
    // structured fields untouched
    expect(record.reward).toBe(0.5);
    expect(record.success).toBe(true);
    expect(record.action).toBe('claude-opus');
    expect(piiMasked).toBe(5);
    // input object not mutated
    expect(input.task).toContain('henrik@example.co.uk');
  });

  it('returns the SAME object when nothing matches (no copy churn)', () => {
    const input = { task: 'plain refactor of the parser', reward: 1, success: true };
    const { record, piiMasked } = redactFreeText(input);
    expect(record).toBe(input);
    expect(piiMasked).toBe(0);
  });
});

// ─── 3. self-inert ──────────────────────────────────────────────────────

describe('ADR-0289 §3 — self-inert without free-text', () => {
  it('metadata-only record passes through identically', () => {
    const input = { taskType: 'code-edit', action: 'haiku', reward: 0.6, success: true };
    const { record } = redactFreeText(input);
    expect(record).toBe(input);
  });

  it('exports the governed field list', () => {
    expect([...EPISODE_FREE_TEXT_FIELDS]).toEqual(['task', 'input', 'output', 'code', 'critique']);
  });
});

// ─── 4. escape hatches ──────────────────────────────────────────────────

describe('ADR-0289 §4 — escape hatches', () => {
  it('AGENTDB_REDACTION_DISABLE=1 disables the whole gate', () => {
    process.env.AGENTDB_REDACTION_DISABLE = '1';
    const input = { task: 'AKIAIOSFODNN7EXAMPLE and henrik@example.com', reward: 1, success: true };
    const { record } = redactFreeText(input);
    expect(record).toBe(input);
  });

  it('AGENTDB_REDACTION_KEEP_PII=1 keeps PII but secrets STILL hard-block', () => {
    process.env.AGENTDB_REDACTION_KEEP_PII = '1';
    const pii = { task: 'mail henrik@example.com', reward: 1, success: true };
    expect(redactFreeText(pii).record).toBe(pii);
    expect(() =>
      redactFreeText({ task: 'AKIAIOSFODNN7EXAMPLE', reward: 1, success: true })
    ).toThrow(AgentDBRedactionError);
  });
});

// ─── 5. fail-loud on detector failure ───────────────────────────────────

describe('ADR-0289 §5 — detector failure never stores raw', () => {
  it('wraps internal errors in AgentDBRedactionError (cause preserved)', () => {
    const boobyTrapped = Object.defineProperty({ reward: 1, success: true }, 'task', {
      enumerable: true,
      get() {
        throw new Error('synthetic detector-path failure');
      },
    });
    let thrown: unknown;
    try {
      redactFreeText(boobyTrapped as object);
    } catch (e) {
      thrown = e;
    }
    const err = thrown as AgentDBRedactionError;
    expect(err.name).toBe('AgentDBRedactionError');
    expect(err.message).toContain('refusing to store raw');
    expect((err.cause as Error).message).toContain('synthetic detector-path failure');
  });
});

// ─── 6. false-positive floor ────────────────────────────────────────────

describe('ADR-0289 §6 — hashes/UUIDs do not hard-block', () => {
  it('passes commit SHAs, sha256 hex, and UUIDs', () => {
    const input = {
      task:
        'fix c7439f345abcdef0123456789abcdef012345678 hash ' +
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 ' +
        'id 550e8400-e29b-41d4-a716-446655440000',
      reward: 1,
      success: true,
    };
    const { record } = redactFreeText(input);
    expect(record.task).toBe(input.task);
  });
});

// ─── 7. storeEpisode wiring ─────────────────────────────────────────────

describe('ADR-0289 §7 — ReflexionMemory.storeEpisode is gated at entry', () => {
  it('calls redactFreeText before any write path', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'controllers', 'ReflexionMemory.ts'),
      'utf8'
    );
    const gateIdx = src.indexOf('redactFreeText(episode)');
    expect(gateIdx).toBeGreaterThan(-1);
    // The gate must precede every persist trigger inside storeEpisode.
    for (const sink of [
      'this.insertEpisodeRow(episode)',
      'this.dualWriteEpisodeToSQL(episode',
      'this.buildEpisodeText(episode)',
    ]) {
      const sinkIdx = src.indexOf(sink);
      expect(sinkIdx, `${sink} should exist`).toBeGreaterThan(-1);
      expect(gateIdx, `gate must precede ${sink}`).toBeLessThan(sinkIdx);
    }
  });
});
