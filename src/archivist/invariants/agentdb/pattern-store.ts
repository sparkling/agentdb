// charter: mutation-invariants
// agentdb_pattern_store mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// Verifies the recorded ReasoningBank pattern write conforms to the schema the
// downstream readers (pattern_search, ranked recall, fallback memory_search) rely
// on. Distinct from cli-side input validation: a non-cli caller (or a future
// dispatch-only callsite) still routes through here.

import type { Invariant } from '../../registration.js';
import type { AgentdbPatternStorePayload } from '../../handlers/agentdb/pattern-store.js';

export type { AgentdbPatternStorePayload };

/** Pattern body must be a non-empty string. The handler embeds it via
 *  EmbeddingScorer; an empty string yields a degenerate vector that pollutes
 *  HNSW recall — surface it as a write-time correctness violation. */
const patternNonEmpty: Invariant<AgentdbPatternStorePayload> = ({ recordedPayload }) => {
  const p = recordedPayload.pattern;
  if (typeof p !== 'string' || p.length === 0) {
    return { violated: true, detail: `pattern must be a non-empty string, got ${typeof p} length=${p?.length ?? 0}` };
  }
  return 'pass';
};

/** Pattern identity — recorded.pattern equals intent.pattern (no truncation
 *  / normalization between dispatch boundary and substrate). */
const patternEquality: Invariant<AgentdbPatternStorePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.pattern !== recordedPayload.pattern) {
    return {
      violated: true,
      detail: `pattern divergence: intent.length=${callerIntent.pattern?.length ?? 0} recorded.length=${recordedPayload.pattern?.length ?? 0}`,
    };
  }
  return 'pass';
};

/** Type tag must be a slug-like string. The handler defaults to `'general'` so
 *  the recorded value should always satisfy this. The fallback path tags the
 *  RVF entry with this string (`tags: [type, ...]`); a non-slug value would
 *  break tag-based filtering. Permits the literal default. */
const TYPE_SLUG_RE = /^[a-z0-9_-]+$/i;
const typeIsSlug: Invariant<AgentdbPatternStorePayload> = ({ recordedPayload }) => {
  const t = recordedPayload.type ?? 'general';
  if (typeof t !== 'string' || !TYPE_SLUG_RE.test(t)) {
    return { violated: true, detail: `type must match /[a-z0-9_-]+/i, got ${JSON.stringify(t)}` };
  }
  return 'pass';
};

/** Confidence must be in [0,1] when present. Outside the range indicates the
 *  cli's `validateScore` defaulting was bypassed. */
const confidenceInRange: Invariant<AgentdbPatternStorePayload> = ({ recordedPayload }) => {
  const c = recordedPayload.confidence;
  if (c === undefined || c === null) return 'pass';
  if (typeof c !== 'number' || !Number.isFinite(c)) {
    return { violated: true, detail: `confidence must be a finite number, got ${String(c)}` };
  }
  if (c < 0 || c > 1) {
    return { violated: true, detail: `confidence must be in [0,1], got ${c}` };
  }
  return 'pass';
};

export const patternStoreInvariants: ReadonlyArray<Invariant<AgentdbPatternStorePayload>> = [
  patternNonEmpty,
  patternEquality,
  typeIsSlug,
  confidenceInRange,
];
