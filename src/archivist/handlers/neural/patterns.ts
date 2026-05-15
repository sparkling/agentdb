// charter: dispatch
// neural_patterns mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<NeuralPatternsMutationPayload>` covering the
// MUTATING subactions of the CLI tool's `neural_patterns` surface:
//   - 'store':  new pattern (depends on generateEmbedding — pending wire-up).
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

// TODO(ADR-0180 Phase 5 wire-up): the 'store' branch requires generateEmbedding
// (Tier-1 agentic-flow ReasoningBank → Tier-2/3 @claude-flow/embeddings → hash
// fallback) which today lives in cli's neural-tools.ts. Wire-up will inject
// the embedder via MutationContext or inline the dynamic-import chain at the
// dispatch boundary. The 'delete' branch is pure-data and lands its body
// inline below.
export const patternsNeuralHandler: GuardedWrite<NeuralPatternsMutationPayload> =
  registerMutationHandler<NeuralPatternsMutationPayload>(
    'neural_patterns',
    async (ctx: MutationContext<false>, payload: NeuralPatternsMutationPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: NEURAL_STORE_ID }, async (handle) => {
        if (payload.action === 'store') {
          throw new Error(
            'archivist: neural_patterns action=store body pending Phase 5 wire-up ' +
            '(generateEmbedding dependency); callers currently route through ' +
            'cli/src/mcp-tools/neural-tools.ts neural_patterns handler',
          );
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
