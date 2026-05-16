// charter: mutation-invariants
// daa_knowledge_share mutation invariants (ADR-0181 §H).
// Writes a DaaKnowledgeRecord under a newly-minted id. sourceAgentId is the
// authoritative provenance; targetAgentIds is the broadcast list.

import type { Invariant } from '../../registration.js';
import type { DaaKnowledgeSharePayload } from '../../handlers/daa/knowledge-share.js';

export type { DaaKnowledgeSharePayload };

const ID_MAX = 500;
const DOMAIN_MAX = 200;

const sourceAgentIdWellFormed: Invariant<DaaKnowledgeSharePayload> = ({ recordedPayload }) => {
  const id = recordedPayload.sourceAgentId;
  if (typeof id !== 'string' || id.length === 0) {
    return { violated: true, detail: `sourceAgentId must be a non-empty string, got ${typeof id} length=${(id as string)?.length ?? 0}` };
  }
  if (id.length > ID_MAX) {
    return { violated: true, detail: `sourceAgentId length ${id.length} exceeds max ${ID_MAX}` };
  }
  return 'pass';
};

/** sourceAgentId identity — TAUTOLOGY today; ships as contract spec. */
const sourceAgentIdEquality: Invariant<DaaKnowledgeSharePayload> = ({ callerIntent, recordedPayload }) => {
  if (callerIntent.sourceAgentId !== recordedPayload.sourceAgentId) {
    return {
      violated: true,
      detail: `sourceAgentId divergence: intent='${callerIntent.sourceAgentId}' recorded='${recordedPayload.sourceAgentId}'`,
    };
  }
  return 'pass';
};

/** targetAgentIds must be an array of non-empty strings (may be empty). */
const targetAgentIdsWellFormed: Invariant<DaaKnowledgeSharePayload> = ({ recordedPayload }) => {
  const ids = recordedPayload.targetAgentIds;
  if (!Array.isArray(ids)) {
    return { violated: true, detail: `targetAgentIds must be an array, got ${typeof ids}` };
  }
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) {
      return { violated: true, detail: `targetAgentIds entries must be non-empty strings, got ${JSON.stringify(id)}` };
    }
  }
  return 'pass';
};

/** knowledgeDomain (optional) ≤200 chars when present. */
const knowledgeDomainBoundedWhenPresent: Invariant<DaaKnowledgeSharePayload> = ({ recordedPayload }) => {
  const d = recordedPayload.knowledgeDomain;
  if (d === undefined || d === null) return 'pass';
  if (typeof d !== 'string') {
    return { violated: true, detail: `knowledgeDomain must be a string when present, got ${typeof d}` };
  }
  if (d.length > DOMAIN_MAX) {
    return { violated: true, detail: `knowledgeDomain length ${d.length} exceeds max ${DOMAIN_MAX}` };
  }
  return 'pass';
};

/** knowledgeContent (optional) must be an object (not array, not null) when present. */
const knowledgeContentObjectWhenPresent: Invariant<DaaKnowledgeSharePayload> = ({ recordedPayload }) => {
  const c = recordedPayload.knowledgeContent;
  if (c === undefined || c === null) return 'pass';
  if (typeof c !== 'object' || Array.isArray(c)) {
    return { violated: true, detail: `knowledgeContent must be a plain object when present, got ${Array.isArray(c) ? 'array' : typeof c}` };
  }
  return 'pass';
};

export const knowledgeShareInvariants: ReadonlyArray<Invariant<DaaKnowledgeSharePayload>> = [
  sourceAgentIdWellFormed,
  sourceAgentIdEquality,
  targetAgentIdsWellFormed,
  knowledgeDomainBoundedWhenPresent,
  knowledgeContentObjectWhenPresent,
];
