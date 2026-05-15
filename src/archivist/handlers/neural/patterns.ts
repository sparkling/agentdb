// charter: dispatch
// neural_patterns mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<NeuralPatternsMutationPayload>` covering the
// MUTATING subactions of the CLI tool's `neural_patterns` surface:
//   - 'store':  new pattern (embeds the name via the EmbeddingScorer capability).
//   - 'delete': remove pattern by id (pure data — body inline).
// The READ subactions ('list', 'get', 'search') belong on a future read
// handler registration; this file owns only the mutation paths so the audit
// chain can record intent → applied | rejected with the right verdicts.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/neural-tools.ts` `neural_patterns`
// handler — switch on `action`; on store it calls `generateEmbedding(name, 384)`
// then writes the new `Pattern` record under a synthetic id; on delete it just
// removes the record. The cli callsite stays in place until the dispatch
// boundary is wired through cli.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/neural/models.json` pattern mutations may run.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
} from '../../index.js';
import {
  NEURAL_STORE_ID,
  NEURAL_STORE_KEY,
  type NeuralStore,
} from './train.js';

/** Mutating subactions only — list/get/search are read-side and registered separately. */
export type NeuralPatternsMutationAction = 'store' | 'delete';

/** Mutation payload — discriminated by `action`. */
export type NeuralPatternsMutationPayload =
  | {
      readonly action: 'store';
      readonly name?: string;
      readonly type?: string;
      readonly data?: Record<string, unknown>;
    }
  | {
      readonly action: 'delete';
      readonly patternId: string;
    };

// The 'store' branch ports the cli `neural_patterns` store action: it embeds
// the pattern name via the `EmbeddingScorer` capability threaded onto
// `MutationContext` (ADR-0180 F4-2 Phase C) — `requireEmbeddingScorer()` fails
// loud if `embeddingScorerFactory` was not wired into `ArchivistInitConfig`,
// the intended substitute for the cli's in-process `generateEmbedding` chain.
// The 'delete' branch is pure-data and needs no capability.
export const patternsNeuralHandler: GuardedWrite<NeuralPatternsMutationPayload> =
  registerMutationHandler<NeuralPatternsMutationPayload>(
    'neural_patterns',
    async (ctx: MutationContext<false>, payload: NeuralPatternsMutationPayload): Promise<void> => {
      // Resolve the embedder before `withWrite` for `store` so an unwired
      // capability fails before the lock is acquired.
      const embedder =
        payload.action === 'store' ? ctx.capabilities.requireEmbeddingScorer() : null;

      await ctx.substrate.withWrite({ storeId: NEURAL_STORE_ID }, async (handle) => {
        if (payload.action === 'store') {
          if (!embedder) {
            throw new Error('neural_patterns: embedding scorer unavailable for action=store');
          }
          const current = await handle.read<NeuralStore>({
            storeId: NEURAL_STORE_ID,
            key: NEURAL_STORE_KEY,
          });
          const store: NeuralStore = current ?? { models: {}, patterns: {}, version: '3.0.0' };

          const patternId = `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const patternName = payload.name ?? 'Unnamed pattern';
          const embedding = Array.from(await embedder.embed(patternName));

          store.patterns[patternId] = {
            id: patternId,
            name: patternName,
            type: payload.type ?? 'general',
            embedding,
            metadata: payload.data ?? {},
            createdAt: new Date().toISOString(),
            usageCount: 0,
          };
          await handle.write<NeuralStore>({
            storeId: NEURAL_STORE_ID,
            key: NEURAL_STORE_KEY,
            payload: store,
          });
          return;
        }

        if (payload.action === 'delete') {
          const current = await handle.read<NeuralStore>({
            storeId: NEURAL_STORE_ID,
            key: NEURAL_STORE_KEY,
          });
          if (!current || !current.patterns[payload.patternId]) {
            throw new Error(
              `neural_patterns: pattern '${payload.patternId}' not found`,
            );
          }
          delete current.patterns[payload.patternId];
          await handle.write<NeuralStore>({
            storeId: NEURAL_STORE_ID,
            key: NEURAL_STORE_KEY,
            payload: current,
          });
          return;
        }
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
