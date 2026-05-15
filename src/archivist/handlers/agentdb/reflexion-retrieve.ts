// charter: dispatch
// agentdb_reflexion_retrieve read handler (ADR-0180 Phase 6, §Architecture · Read-path
// return shape + §Provenance rollout scope).
//
// Reflexion recall is a ranked read — `ReflexionMemory.retrieveRelevant` returns
// episodes ordered by semantic similarity to the query task. Per ADR-0180
// §Provenance rollout scope, ranked reads MUST be able to surface provenance so
// downstream ExplainableRecall can attribute each hit to (storeId, matchType,
// rawScore, rank) without a second query. Legacy callers continue to receive the
// raw episode array (back-compat); provenance-aware callers pass
// `includeProvenance: true` at the cli boundary and receive `RankedResults<T>`.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_reflexion_retrieve` handler (line 958) — delegates to the package-level
// `ReflexionMemory.retrieveRelevant({ task, k })`. Per Phase 5 deferral F4-3, the
// cli callsite stays authoritative during the migration window — this file
// establishes the registration shape the dispatch path will resolve when the
// boundary is wired.
//
// Type-enforcement: `ctx.substrate` is read-only narrowing (`ReadContext`, no audit,
// no guard). Per ADR-0180 §Read-path cache writes, this handler MAY populate
// in-memory caches (embedding cache for the query task) without invoking
// MutationGuard.

import { registerReadHandler, type GuardedRead, type ReadContext, type StoreId } from '../../index.js';
import type { RankedResult, RankedResults } from '../memory/search.js';

/**
 * Input payload mirroring the CLI tool's `agentdb_reflexion_retrieve` input shape
 * (agentdb-tools.ts:961-968) plus the underlying `ReflexionMemory.retrieveRelevant`
 * filter knobs (onlyFailures / onlySuccesses / minReward) that the CLI passes
 * positionally today.
 */
export interface AgentdbReflexionRetrieveQuery {
  readonly task: string;
  readonly k?: number;
  readonly onlyFailures?: boolean;
  readonly onlySuccesses?: boolean;
  readonly minReward?: number;
}

/**
 * Reflexion episode hit shape. Mirrors the `ReflexionMemory.retrieveRelevant`
 * return shape so a dispatch-side flatten back to the legacy episode array is
 * a field-pick when `includeProvenance: false`.
 */
export interface ReflexionEpisodeHit {
  readonly id: number | string;
  readonly task: string;
  readonly reward: number;
  readonly success: boolean;
  readonly similarity?: number;
  readonly critique?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly metadata?: Record<string, unknown>;
}

const STORE_ID = 'agentdb_reflexion_retrieve' as StoreId;

/**
 * On-disk document the FS-JSON `agentdb_reflexion_retrieve` substrate owns.
 * `key: 'root'` holds the episode corpus the reflexion-store write path
 * persists. Each episode carries an optional `similarity` populated at write
 * time (the embedding-distance to the episode's own task) — used for ranking
 * here in place of a live re-embed of the query task.
 */
interface ReflexionStore {
  readonly episodes: ReadonlyArray<ReflexionEpisodeHit>;
}

// F4-2 wire-up (Phase B substrate seam live): this handler reads the persisted
// episode corpus through `ctx.substrate.read` (whole-document FS-JSON store),
// applies the `onlyFailures` / `onlySuccesses` / `minReward` filter knobs the
// cli passes to `ReflexionMemory.retrieveRelevant`, ranks by the precomputed
// `similarity`, caps at `k`, and emits `RankedResult<ReflexionEpisodeHit>[]`
// with provenance per episode.
//
// The cli path runs `retrieveRelevant` against the live ReflexionMemory
// controller, which re-embeds the query `task` and scores each episode by
// fresh cosine similarity. That re-embed is NOT reproducible here: it needs the
// embedding service, and `ArchivistInitConfig` threads only `rvfBackend` /
// `sqliteDb` / `projectRoot` — no controller registry. So ranking uses the
// similarity captured at write time. See the TODO(F4-2-config) below.
export const reflexionRetrieveHandler: GuardedRead<AgentdbReflexionRetrieveQuery, RankedResults<ReflexionEpisodeHit>> =
  registerReadHandler<AgentdbReflexionRetrieveQuery, RankedResults<ReflexionEpisodeHit>>(
    'agentdb_reflexion_retrieve',
    async (ctx: ReadContext, payload: AgentdbReflexionRetrieveQuery): Promise<RankedResults<ReflexionEpisodeHit>> => {
      const store = await ctx.substrate.read<ReflexionStore>({ storeId: STORE_ID, key: 'root' });
      const corpus = store?.episodes ?? [];

      const k = payload.k ?? 5;

      // TODO(F4-2-config): the cli's `retrieveRelevant` re-embeds the query
      // `task` against the live ReflexionMemory controller and scores each
      // episode by fresh cosine similarity. The embedding service is not
      // threaded through `ArchivistInitConfig`, so ranking falls back to the
      // `similarity` persisted at write time.
      const ranked = corpus
        .filter((ep) => (payload.onlyFailures ? ep.success === false : true))
        .filter((ep) => (payload.onlySuccesses ? ep.success === true : true))
        .filter((ep) => (payload.minReward !== undefined ? ep.reward >= payload.minReward : true))
        .slice()
        .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
        .slice(0, k);

      return ranked.map((ep, index): RankedResult<ReflexionEpisodeHit> => ({
        item: ep,
        score: ep.similarity ?? 0,
        provenance: {
          storeId: 'reflexion',
          matchType: 'semantic',
          rawScore: ep.similarity ?? 0,
          rank: index + 1,
          matchedField: 'task',
        },
      }));
    },
    { cacheScope: 'namespace' },
  );
