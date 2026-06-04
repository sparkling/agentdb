/**
 * ADR-0289: PII/secret redaction before durable capture of conversational
 * content.
 *
 * Policy (tiered — ADR-0289 Option C):
 *   - SECRETS are always HARD-BLOCKED while the gate is enabled: a detected
 *     credential aborts the write with `AgentDBRedactionError` (the row is
 *     never written, even masked). Non-configurable floor.
 *   - PII (emails, SSN/CC shapes, home-directory usernames) is MASKED by
 *     default before any persist or embed; opt-out via
 *     `AGENTDB_REDACTION_KEEP_PII=1`.
 *   - Structured fields are never touched — only the free-text fields
 *     (`task`, `input`, `output`, `code`, `critique`) are scanned, so the
 *     NightlyLearner action-value signal (action/task_type/reward/success)
 *     is unaffected by construction.
 *   - FAIL-LOUD: a detector failure never falls back to storing raw text —
 *     it surfaces as `AgentDBRedactionError` (ADR-0286 /
 *     `feedback-best-effort-must-rethrow-fatals`).
 *   - Default ON, self-inert: when the free-text fields are absent/empty
 *     (e.g. ADR-0290 Phase-1 metadata-only episodes) the gate is a no-op.
 *     Escape hatch to disable the whole gate: `AGENTDB_REDACTION_DISABLE=1`
 *     (per `feedback-no-dormant-off-by-default-flags`: ship ON, hatch to
 *     DISABLE — never a dormant opt-in).
 *
 * The error intentionally carries only `{ kind, field }` descriptors —
 * never the matched secret itself — so surfacing the failure cannot leak
 * the credential into logs.
 */

/** Free-text episode columns governed by ADR-0289. */
export const EPISODE_FREE_TEXT_FIELDS = [
  'task',
  'input',
  'output',
  'code',
  'critique',
] as const;

export interface RedactionViolation {
  /** Pattern family that matched (e.g. 'aws-access-key-id'). */
  kind: string;
  /** Which free-text field contained it. */
  field: string;
}

/**
 * Named so cross-package consumers can discriminate by `.name` (the
 * `AgentDBInitError` precedent, core/AgentDB.ts — survives bundling and
 * multiple package instances where `instanceof` does not).
 */
export class AgentDBRedactionError extends Error {
  readonly violations: ReadonlyArray<RedactionViolation>;
  constructor(
    message: string,
    violations: ReadonlyArray<RedactionViolation> = [],
    options?: { cause?: unknown }
  ) {
    super(message, options as ErrorOptions);
    this.name = 'AgentDBRedactionError';
    this.violations = violations;
  }
}

/** Whole-gate escape hatch (default: enabled). */
export function isRedactionDisabled(): boolean {
  const v = process.env.AGENTDB_REDACTION_DISABLE;
  return v === '1' || v === 'true';
}

/** PII-mask opt-out (secrets still hard-block; default: mask). */
export function isPiiMaskingDisabled(): boolean {
  const v = process.env.AGENTDB_REDACTION_KEEP_PII;
  return v === '1' || v === 'true';
}

// ── Secret detectors (hard-block) ──────────────────────────────────────────
// Known-prefix families mirror the battle-tested key-name list in
// validation.ts `sanitizeMetadata` (secret/password/token/key/credential/…),
// extended with concrete credential shapes.
const SECRET_PATTERNS: ReadonlyArray<{ kind: string; re: RegExp }> = [
  { kind: 'pem-private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { kind: 'github-fine-grained-pat', re: /\bgithub_pat_[A-Za-z0-9_]{36,}\b/ },
  { kind: 'slack-token', re: /\bxox[bporsa]-[A-Za-z0-9-]{10,}\b/ },
  { kind: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: 'stripe-key', re: /\b[sp]k_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  // OpenAI/Anthropic-style `sk-…` (after stripe's more specific sk_ forms).
  { kind: 'sk-prefixed-api-key', re: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  {
    kind: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/,
  },
  { kind: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9_~+/.=-]{20,}/i },
  // `api_key = <value>` assignment forms. The value must look credential-like:
  // ≥16 chars, contains a digit, and excludes placeholder markers (<>, ${}),
  // quotes and whitespace — so `password: <your-password>` does not trip it.
  {
    kind: 'assignment-secret',
    re: /\b(?:api[_-]?key|secret|token|password|passwd|credential)\s*[=:]\s*["']?(?=[^\s"'<>${}]*\d)[A-Za-z0-9_/+.-]{16,}/i,
  },
];

// High-entropy catch-all for opaque credentials with no known prefix.
// Threshold 4.2 bits/char deliberately exceeds the 4.0 maximum of pure hex,
// so commit SHAs / content hashes / UUIDs in task text do NOT hard-block;
// real base64-ish secrets typically measure 4.4+.
const ENTROPY_CANDIDATE_RE = /\b[A-Za-z0-9_+/=-]{32,}\b/g;
const ENTROPY_THRESHOLD_BITS = 4.2;

function shannonEntropyBitsPerChar(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Returns the violation kinds found in one text (no match content). */
function findSecrets(text: string): string[] {
  const kinds: string[] = [];
  for (const { kind, re } of SECRET_PATTERNS) {
    if (re.test(text)) kinds.push(kind);
  }
  const candidates = text.match(ENTROPY_CANDIDATE_RE);
  if (candidates) {
    for (const c of candidates) {
      if (shannonEntropyBitsPerChar(c) >= ENTROPY_THRESHOLD_BITS) {
        kinds.push('high-entropy-token');
        break;
      }
    }
  }
  return kinds;
}

// ── PII maskers (mask-by-default) ──────────────────────────────────────────
const PII_MASKS: ReadonlyArray<{
  kind: string;
  re: RegExp;
  replacement: string;
}> = [
  {
    kind: 'email',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '<redacted-email>',
  },
  { kind: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '<redacted-id>' },
  {
    // Separated card-number groups only. Unseparated 13-16 digit runs are
    // NOT matched (epoch-millis/micros timestamps would false-positive).
    kind: 'card-number',
    re: /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b/g,
    replacement: '<redacted-id>',
  },
  {
    // macOS/Linux home-directory usernames inside paths.
    kind: 'home-dir-username',
    re: /(\/(?:Users|home)\/)([A-Za-z0-9._-]+)/g,
    replacement: '$1<redacted-user>',
  },
];

function maskPii(text: string): { text: string; masked: number } {
  let masked = 0;
  let out = text;
  for (const { re, replacement } of PII_MASKS) {
    out = out.replace(re, (...args: unknown[]) => {
      masked += 1;
      // A function replacer returns its result literally — expand $1-style
      // capture references in the template ourselves (home-dir mask).
      return replacement.replace(/\$(\d)/g, (_m, g: string) => String(args[Number(g)] ?? ''));
    });
  }
  return { text: out, masked };
}

export interface RedactFreeTextResult<T> {
  /** A shallow copy with masked free-text fields (input object untouched). */
  record: T;
  /** Number of PII spans masked across all fields. */
  piiMasked: number;
}

/**
 * Scan + redact the given free-text fields of a record.
 *
 * @throws AgentDBRedactionError when a secret is detected (hard-block) or
 *         when the detector itself fails (fail-loud — never store raw).
 */
export function redactFreeText<T extends object>(
  record: T,
  fields: ReadonlyArray<string> = EPISODE_FREE_TEXT_FIELDS
): RedactFreeTextResult<T> {
  if (isRedactionDisabled()) return { record, piiMasked: 0 };
  try {
    const violations: RedactionViolation[] = [];
    for (const field of fields) {
      const value = (record as Record<string, unknown>)[field];
      if (typeof value !== 'string' || value.length === 0) continue;
      for (const kind of findSecrets(value)) violations.push({ kind, field });
    }
    if (violations.length > 0) {
      throw new AgentDBRedactionError(
        `secret detected in free-text field(s) ${[...new Set(violations.map(v => v.field))].join(', ')} — ` +
          'write hard-blocked per ADR-0289 (secrets are never stored, even masked)',
        violations
      );
    }
    if (isPiiMaskingDisabled()) return { record, piiMasked: 0 };
    let piiMasked = 0;
    let out: T | null = null;
    for (const field of fields) {
      const value = (record as Record<string, unknown>)[field];
      if (typeof value !== 'string' || value.length === 0) continue;
      const { text, masked } = maskPii(value);
      if (masked > 0) {
        piiMasked += masked;
        if (out === null) out = { ...record };
        (out as Record<string, unknown>)[field] = text;
      }
    }
    return { record: out ?? record, piiMasked };
  } catch (err) {
    if (err instanceof AgentDBRedactionError || (err as Error)?.name === 'AgentDBRedactionError') {
      throw err;
    }
    // Detector failure ⇒ refuse to store raw (ADR-0289 fail-loud).
    throw new AgentDBRedactionError(
      `redaction gate failed (${err instanceof Error ? err.message : String(err)}) — refusing to store raw free-text per ADR-0289`,
      [],
      { cause: err }
    );
  }
}
