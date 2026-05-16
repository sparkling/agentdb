// charter: mutation-invariants
// neural_patterns mutation invariants (ADR-0180 §Architecture · Mutation invariants).
// The handler discriminates `action` ∈ {store, delete}. Bad action / empty name /
// empty patternId would corrupt the pattern store.

import type { Invariant } from '../../registration.js';
import type { NeuralPatternsMutationPayload } from '../../handlers/neural/patterns.js';

export type { NeuralPatternsMutationPayload };

const VALID_ACTIONS = new Set(['store', 'delete']);
const NAME_MAX = 500;

/** action must be one of {store, delete}. */
const actionInEnum: Invariant<NeuralPatternsMutationPayload> = ({ recordedPayload }) => {
  const a = recordedPayload.action;
  if (!VALID_ACTIONS.has(a as string)) {
    return { violated: true, detail: `action must be one of {store,delete}, got ${JSON.stringify(a)}` };
  }
  return 'pass';
};

/** action identity — TAUTOLOGY TODAY. */
const actionEquality: Invariant<NeuralPatternsMutationPayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.action !== recordedPayload.action) {
    return { violated: true, detail: `action divergence: intent='${callerIntent.action}' recorded='${recordedPayload.action}'` };
  }
  return 'pass';
};

/** store action: name, when present, must be a non-empty string ≤500 chars
 *  (embedded via the EmbeddingScorer — degenerate empty produces a useless
 *  zero-vector). Note: handler defaults absent name to 'Unnamed pattern', so
 *  we only validate when explicitly provided. */
const namePresenceAndLength: Invariant<NeuralPatternsMutationPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'store') return 'pass';
  const n = recordedPayload.name;
  if (n === undefined) return 'pass';
  if (typeof n !== 'string' || n.length === 0) {
    return { violated: true, detail: `name must be a non-empty string when present, got ${typeof n} length=${(n as string)?.length ?? 0}` };
  }
  if (n.length > NAME_MAX) {
    return { violated: true, detail: `name length ${n.length} exceeds max ${NAME_MAX}` };
  }
  return 'pass';
};

/** delete action: patternId must be a non-empty string. */
const patternIdNonEmpty: Invariant<NeuralPatternsMutationPayload> = ({ recordedPayload }) => {
  if (recordedPayload.action !== 'delete') return 'pass';
  const id = recordedPayload.patternId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `patternId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  return 'pass';
};

export const patternsInvariants: ReadonlyArray<Invariant<NeuralPatternsMutationPayload>> = [
  actionInEnum,
  actionEquality,
  namePresenceAndLength,
  patternIdNonEmpty,
];
