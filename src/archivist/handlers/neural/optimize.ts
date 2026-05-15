// charter: dispatch
// neural_optimize mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<NeuralOptimizePayload>` so every optimization
// transitions through the archivist's audit chain.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/neural-tools.ts` `neural_optimize`
// handler — branches on `target` ∈ {speed, memory, accuracy, balanced}:
//   - speed | balanced: dedup near-identical patterns (8-dim hash bucket +
//     full cosine verify > 0.99, keep max usageCount).
//   - memory | balanced: quantization is skipped (ADR-0086 Phase 1 removed
//     memory-initializer's quantizeInt8/getQuantizationStats).
//   - accuracy | balanced: prune zero-embedding / all-zero patterns.
// Operates on `.claude-flow/neural/models.json` via loadNeuralStore /
// saveNeuralStore; the cli callsite stays in place until the dispatch boundary
// is wired through cli. All branches are pure-data and land their bodies
// inline.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/neural/models.json` mutations may run.

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

/** Optimization targets — matches the CLI inputSchema enum. */
export type NeuralOptimizeTarget = 'speed' | 'memory' | 'accuracy' | 'balanced';

/** Mutation payload mirroring the CLI tool's `neural_optimize` input shape. */
export interface NeuralOptimizePayload {
  readonly modelId?: string;
  readonly target?: NeuralOptimizeTarget;
}

function cosineSimilarity(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

// TODO(ADR-0180 Phase 5 wire-up): cli callsite continues to route through
// neural-tools.ts `neural_optimize` until the dispatch boundary is exposed.
export const optimizeNeuralHandler: GuardedWrite<NeuralOptimizePayload> =
  registerMutationHandler<NeuralOptimizePayload>(
    'neural_optimize',
    async (ctx: MutationContext<false>, payload: NeuralOptimizePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: NEURAL_STORE_ID }, async (handle) => {
        const target: NeuralOptimizeTarget = payload.target ?? 'balanced';

        const current = await handle.read<NeuralStore>({
          storeId: NEURAL_STORE_ID,
          key: NEURAL_STORE_KEY,
        });
        const store: NeuralStore = current ?? { models: {}, patterns: {}, version: '3.0.0' };

        if (Object.keys(store.patterns).length === 0) {
          throw new Error(
            'neural_optimize: no patterns to optimize — train patterns first with neural_train',
          );
        }

        // speed | balanced: dedup near-identical patterns via 8-dim hash bucket
        // then verify with full cosine > 0.99.
        if (target === 'speed' || target === 'balanced') {
          const seen = new Map<string, string>();
          for (const [id, p] of Object.entries(store.patterns)) {
            if (p.embedding.length === 0) continue;
            const hash = p.embedding.slice(0, 8).map((v) => v.toFixed(4)).join(',');
            const existingId = seen.get(hash);
            if (existingId !== undefined) {
              const existing = store.patterns[existingId];
              if (existing && cosineSimilarity(p.embedding, existing.embedding) > 0.99) {
                existing.usageCount = Math.max(existing.usageCount ?? 0, p.usageCount ?? 0);
                delete store.patterns[id];
                continue;
              }
            }
            seen.set(hash, id);
          }
        }

        // memory | balanced: quantization removed in ADR-0086 Phase 1; no-op
        // here — the `_action` audit field will record "Quantization skipped".

        // accuracy | balanced: prune zero-signal patterns (missing or
        // all-zero embeddings).
        if (target === 'accuracy' || target === 'balanced') {
          for (const [id, p] of Object.entries(store.patterns)) {
            if (p.embedding.length === 0) {
              delete store.patterns[id];
              continue;
            }
            const norm = p.embedding.reduce((s, v) => s + v * v, 0);
            if (norm < 1e-10) {
              delete store.patterns[id];
            }
          }
        }

        await handle.write<NeuralStore>({
          storeId: NEURAL_STORE_ID,
          key: NEURAL_STORE_KEY,
          payload: store,
        });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
