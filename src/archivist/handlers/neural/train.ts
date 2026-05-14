// charter: dispatch
// neural_train mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<NeuralTrainPayload>` so every training run
// transitions through the archivist's audit chain (intent → applied | rejected)
// with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/neural-tools.ts` `neural_train`
// handler — loads `.claude-flow/neural/models.json` via `loadNeuralStore`,
// mints a `NeuralModel` record, embeds every entry in `input.data` via
// `generateEmbedding` (Tier 1 agentic-flow ReasoningBank → Tier 2/3
// @claude-flow/embeddings → hash fallback), persists patterns under
// `${modelId}-train-${i}`, flips status to 'ready', and saves via
// `saveNeuralStore`. The cli callsite stays in place until the dispatch
// boundary is wired through cli (mirroring memory_store / hive-mind_spawn).
//
// The embedding dependency is intentionally NOT pulled into the archivist
// substrate seam: `generateEmbedding` lives in cli and resolves dynamic
// imports at runtime. Phase 5 establishes the FS-JSON registration shape;
// wire-up phase will either inject the embedder via MutationContext or
// inline the dynamic-import chain at the dispatch boundary.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/neural/models.json` mutations may run. Direct fs writes on
// the file are forbidden by the `no-restricted-imports` backstop and the
// path-restricted substrate-internal.ts seam (ADR-0180 §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/** Model kinds — matches the CLI inputSchema enum. */
export type NeuralModelType = 'moe' | 'transformer' | 'classifier' | 'embedding';

/** Model record persisted under `.claude-flow/neural/models.json`. */
export interface NeuralModel {
  readonly id: string;
  readonly name: string;
  readonly type: NeuralModelType;
  status: 'untrained' | 'training' | 'ready' | 'error';
  accuracy: number;
  trainedAt?: string;
  readonly epochs: number;
  readonly config: Record<string, unknown>;
}

/** Pattern record persisted under the same FS-JSON file. */
export interface NeuralPattern {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly embedding: ReadonlyArray<number>;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  usageCount: number;
}

/** Canonical store shape — shared by every neural_* handler. */
export interface NeuralStore {
  models: Record<string, NeuralModel>;
  patterns: Record<string, NeuralPattern>;
  readonly version: string;
}

/** Mutation payload mirroring the CLI tool's `neural_train` input shape. */
export interface NeuralTrainPayload {
  readonly modelId?: string;
  readonly modelType: NeuralModelType;
  readonly epochs?: number;
  readonly learningRate?: number;
  readonly data?: unknown;
}

export const NEURAL_STORE_ID = 'neural' as StoreId;
export const NEURAL_STORE_KEY = 'root';

// TODO(ADR-0180 Phase 5 wire-up): port the cli `neural_train` body once the
// dispatch boundary is wired through cli AND the embedding adapter is
// reachable from inside the archivist seam. The wrapper-in-cli pattern
// (loadNeuralStore → mint model → embed-each(data) → saveNeuralStore) collapses
// to a single `ctx.substrate.withWrite` here. The embed-each step depends on
// `generateEmbedding`'s Tier-1/2/3 chain, which the wire-up commit will inject
// via MutationContext (or inline at the dispatch boundary).
export const trainNeuralHandler: GuardedWrite<NeuralTrainPayload> =
  registerMutationHandler<NeuralTrainPayload>(
    'neural_train',
    async (ctx: MutationContext<false>, _payload: NeuralTrainPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: NEURAL_STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: neural_train handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/neural-tools.ts neural_train handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
