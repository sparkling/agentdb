// charter: mutation-invariants
// daa_cognitive_pattern mutation invariants (ADR-0181 §H).
// Only the WRITE path (action='change') routes through the mutation handler;
// the handler explicitly rejects 'analyze' (read). These invariants guard
// the dispatch boundary so a non-cli caller cannot route 'analyze' here.

import type { Invariant } from '../../registration.js';
import type { DaaCognitivePatternPayload } from '../../handlers/daa/cognitive-pattern.js';

export type { DaaCognitivePatternPayload };

const ID_MAX = 500;
const VALID_PATTERNS = new Set([
  'convergent',
  'divergent',
  'lateral',
  'systems',
  'critical',
  'adaptive',
]);

/** action must be 'change' on the mutation path. The handler rejects
 *  'analyze' / catalogue reads — guard them at the invariant boundary too. */
const actionIsChange: Invariant<DaaCognitivePatternPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'change') {
    return { violated: true, detail: `action must be 'change' on mutation path, got ${JSON.stringify(recordedPayload.action)}` };
  }
  return 'pass';
};

/** action identity — TAUTOLOGY today; ships as contract spec. */
const actionEquality: Invariant<DaaCognitivePatternPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.action !== recordedPayload.action) {
    return {
      violated: true,
      detail: `action divergence: intent='${callerIntent.action}' recorded='${recordedPayload.action}'`,
    };
  }
  return 'pass';
};

/** agentId required on action='change' (the handler throws if missing). */
const agentIdWellFormed: Invariant<DaaCognitivePatternPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'change') return 'pass';
  const id = recordedPayload.agentId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `agentId is required for action='change', got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `agentId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** pattern required on action='change' and must be one of the six variants. */
const patternInEnum: Invariant<DaaCognitivePatternPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'change') return 'pass';
  const p = recordedPayload.pattern;
  if (typeof p !== 'string' || !VALID_PATTERNS.has(p)) {
    return { violated: true, detail: `pattern must be one of {${[...VALID_PATTERNS].join(',')}} for action='change', got ${JSON.stringify(p)}` };
  }
  return 'pass';
};

export const cognitivePatternInvariants: ReadonlyArray<Invariant<DaaCognitivePatternPayload>> = [
  actionIsChange,
  actionEquality,
  agentIdWellFormed,
  patternInEnum,
];
