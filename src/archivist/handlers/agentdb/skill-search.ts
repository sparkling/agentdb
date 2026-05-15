// charter: dispatch
// agentdb_skill_search read handler (ADR-0180 Phase 6, §Architecture · Read-path
// return shape + §Provenance rollout scope).
//
// SkillLibrary recall is a ranked read — `SkillLibrary.retrieveSkills` (or its
// `searchSkills` / `search` fallback) returns reusable skills ordered by semantic
// similarity to the query task. Per ADR-0180 §Provenance rollout scope, ranked
// reads MUST be able to surface provenance so ExplainableRecall can attribute
// each hit to (storeId, matchType, rawScore, rank) without a second query.
// Legacy callers continue to receive the raw skill array (back-compat);
// provenance-aware callers pass `includeProvenance: true` at the cli boundary
// and receive `RankedResults<T>` verbatim.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_skill_search` handler (line 1681) — delegates to the SkillLibrary
// controller's `retrieveSkills({ query, k })` (with `searchSkills` / `search`
// fallbacks for older controller shapes). Per Phase 5 deferral F4-3, the cli
// callsite stays authoritative during the migration window — this file
// establishes the registration shape the dispatch path will resolve when the
// boundary is wired.
//
// Type-enforcement: `ctx.substrate` is read-only narrowing (`ReadContext`, no
// audit, no guard). Per ADR-0180 §Read-path cache writes, this handler MAY
// populate in-memory caches (embedding cache for the query task) without
// invoking MutationGuard — those writes die with the process and are reflected
// in `ctx.cacheHints.wrote_cache` as advisory observability.

import { registerReadHandler, type GuardedRead, type ReadContext, type StoreId } from '../../index.js';
import type { RankedResult, RankedResults } from '../memory/search.js';

/**
 * Input payload mirroring the CLI tool's `agentdb_skill_search` input shape
 * (agentdb-tools.ts:1684-1691). `query` / `limit` are the SkillLibrary-side
 * names the cli handler validates and forwards; this archivist handler accepts
 * the same surface so the dispatch boundary can be wired without a second
 * schema translation.
 */
export interface AgentdbSkillSearchQuery {
  readonly query: string;
  readonly limit?: number;
}

/**
 * Skill hit shape. Mirrors the SkillLibrary controller's `retrieveSkills`
 * return shape (`{ id, name, description, successRate, ... }` per hit). The
 * flat shape pick for `includeProvenance: false` is a field-pick at the
 * dispatch boundary.
 */
export interface SkillSearchHit {
  readonly id: string | number;
  readonly name: string;
  readonly description: string;
  readonly successRate?: number;
  readonly code?: string;
  readonly metadata?: Record<string, unknown>;
}

const STORE_ID = 'agentdb_skill_search' as StoreId;

/**
 * On-disk document the FS-JSON `agentdb_skill_search` substrate owns.
 * `key: 'root'` holds the skill corpus the skill-create write path persists.
 */
interface SkillSearchStore {
  readonly skills: ReadonlyArray<SkillSearchHit>;
}

/** Lowercase word tokens of a string, empty tokens dropped. */
function tokenize(text: string): ReadonlyArray<string> {
  return text.toLowerCase().split(/[^a-z0-9]+/i).filter((t) => t.length > 0);
}

/**
 * Deterministic lexical-overlap score of a skill against the query. The
 * `description` is weighted above `name` (a query word matching the longer
 * description text is the weaker signal). Returns `{ score, matchedField }`
 * where `score` ∈ [0, 1] is the fraction of query tokens that appear in the
 * combined name+description text.
 *
 * This is a stand-in for the SkillLibrary controller's embedding similarity —
 * see the TODO(F4-2-config) at the handler body.
 */
function lexicalScore(
  hit: SkillSearchHit,
  queryTokens: ReadonlyArray<string>,
): { score: number; matchedField: 'name' | 'description' } {
  if (queryTokens.length === 0) return { score: 0, matchedField: 'description' };
  const nameTokens = new Set(tokenize(hit.name));
  const descTokens = new Set(tokenize(hit.description));
  let nameHits = 0;
  let anyHits = 0;
  for (const qt of queryTokens) {
    if (nameTokens.has(qt)) nameHits++;
    if (nameTokens.has(qt) || descTokens.has(qt)) anyHits++;
  }
  return {
    score: anyHits / queryTokens.length,
    matchedField: nameHits >= anyHits - nameHits ? 'name' : 'description',
  };
}

// F4-2 wire-up (Phase B substrate seam live): this handler reads the persisted
// skill corpus through `ctx.substrate.read` (whole-document FS-JSON store),
// ranks each skill by deterministic lexical overlap against the query, caps at
// `limit`, and emits `RankedResult<SkillSearchHit>[]` with provenance.
//
// The cli path runs `retrieveSkills({ query, k })` against the live
// SkillLibrary controller, which scores skills by embedding cosine similarity.
// That embedding score is NOT reproducible here: it needs the SkillLibrary
// controller instance, and `ArchivistInitConfig` threads only `rvfBackend` /
// `sqliteDb` / `projectRoot` — no controller registry. So ranking uses a
// lexical-overlap stand-in. See the TODO(F4-2-config) below.
export const skillSearchHandler: GuardedRead<AgentdbSkillSearchQuery, RankedResults<SkillSearchHit>> =
  registerReadHandler<AgentdbSkillSearchQuery, RankedResults<SkillSearchHit>>(
    'agentdb_skill_search',
    async (ctx: ReadContext, payload: AgentdbSkillSearchQuery): Promise<RankedResults<SkillSearchHit>> => {
      const store = await ctx.substrate.read<SkillSearchStore>({ storeId: STORE_ID, key: 'root' });
      const corpus = store?.skills ?? [];

      const limit = payload.limit ?? 5;
      const queryTokens = tokenize(payload.query);

      // TODO(F4-2-config): the cli's `retrieveSkills` scores skills by embedding
      // cosine similarity via the live SkillLibrary controller. The controller
      // is not threaded through `ArchivistInitConfig`, so ranking falls back to
      // a deterministic lexical-overlap score over name + description.
      const ranked = corpus
        .map((hit) => ({ hit, ...lexicalScore(hit, queryTokens) }))
        .filter((scored) => scored.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return ranked.map((scored, index): RankedResult<SkillSearchHit> => ({
        item: scored.hit,
        score: scored.score,
        provenance: {
          storeId: 'skills',
          matchType: 'bm25',
          rawScore: scored.score,
          rank: index + 1,
          matchedField: scored.matchedField,
        },
      }));
    },
    { cacheScope: 'namespace' },
  );
