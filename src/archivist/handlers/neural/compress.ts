// charter: dispatch
// neural_compress mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<NeuralCompressPayload>` so every compression
// transitions through the archivist's audit chain.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/neural-tools.ts` `neural_compress`
// handler — branches on `method` ∈ {quantize, prune, distill}:
//   - quantize: errors out (ADR-0086 Phase 1 removed memory-initializer).
//   - prune: deletes patterns with usageCount < targetReduction threshold.
//   - distill: merges pairs with cosine similarity > 0.95 (average embeddings,
//     keep higher usage count, delete duplicate).
// Operates on `.claude-flow/neural/models.json` via loadNeuralStore /
// saveNeuralStore; the cli callsite stays in place until the dispatch boundary
// is wired through cli. The prune + distill branches are pure-data and can
// land their bodies inline; the wire-up phase only needs to route cli calls
// through dispatch.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/neural/models.json` mutations may run.

import { registerMutationHandler } from '../../registration.js';
import type { MutationContext } from '../../mutation-context.js';
import type { GuardedWrite } from '../../types.js';
import { compressInvariants } from '../../invariants/neural/compress.js';
import {
  NEURAL_STORE_ID,
  NEURAL_STORE_KEY,
  type NeuralPattern,
  type NeuralStore,
} from './train.js';

/** Compression methods — matches the CLI inputSchema enum. */
export type NeuralCompressMethod = 'quantize' | 'prune' | 'distill';

/** Mutation payload mirroring the CLI tool's `neural_compress` input shape. */
export interface NeuralCompressPayload {
  readonly modelId?: string;
  readonly method?: NeuralCompressMethod;
  readonly targetSize?: number;
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

// TODO(ADR-0180 Phase 5 wire-up): the cli callsite continues to route through
// neural-tools.ts `neural_compress` until the dispatch boundary is exposed.
// At wire-up time the cli's loadNeuralStore + saveNeuralStore pair collapses
// to this single `ctx.substrate.withWrite`.
export const compressNeuralHandler: GuardedWrite<NeuralCompressPayload> =
  registerMutationHandler<NeuralCompressPayload>(
    'neural_compress',
    async (ctx: MutationContext<false>, payload: NeuralCompressPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: NEURAL_STORE_ID }, async (handle) => {
        const method: NeuralCompressMethod = payload.method ?? 'quantize';

        if (method === 'quantize') {
          // ADR-0086 Phase 1 removed memory-initializer (which provided
          // quantizeInt8/getQuantizationStats); surface as an explicit failure
          // rather than silently no-op.
          throw new Error(
            'neural_compress: quantize unavailable — memory-initializer was removed in ADR-0086 Phase 1',
          );
        }

        const current = await handle.read<NeuralStore>({
          storeId: NEURAL_STORE_ID,
          key: NEURAL_STORE_KEY,
        });
        const store: NeuralStore = current ?? { models: {}, patterns: {}, version: '3.0.0' };

        const patternIds = Object.keys(store.patterns);
        if (patternIds.length === 0) {
          throw new Error(
            'neural_compress: no patterns to compress — train patterns first with neural_train',
          );
        }

        const targetReduction = payload.targetSize ?? 0.5;

        if (method === 'prune') {
          const threshold = targetReduction;
          for (const id of patternIds) {
            const pattern = store.patterns[id];
            if ((pattern.usageCount ?? 0) < threshold) {
              delete store.patterns[id];
            }
          }
          await handle.write<NeuralStore>({
            storeId: NEURAL_STORE_ID,
            key: NEURAL_STORE_KEY,
            payload: store,
          });
          return;
        }

        if (method === 'distill') {
          const entries: Array<[string, NeuralPattern]> = Object.entries(store.patterns);
          const merged = new Set<string>();
          for (let i = 0; i < entries.length; i++) {
            const [idA, a] = entries[i];
            if (merged.has(idA)) continue;
            for (let j = i + 1; j < entries.length; j++) {
              const [idB, b] = entries[j];
              if (merged.has(idB) || a.embedding.length === 0 || b.embedding.length === 0) {
                continue;
              }
              if (cosineSimilarity(a.embedding, b.embedding) > 0.95) {
                const avg: number[] = new Array(a.embedding.length);
                for (let k = 0; k < a.embedding.length; k++) {
                  avg[k] = (a.embedding[k] + (b.embedding[k] ?? 0)) / 2;
                }
                store.patterns[idA] = {
                  ...a,
                  embedding: avg,
                  usageCount: Math.max(a.usageCount ?? 0, b.usageCount ?? 0),
                };
                delete store.patterns[idB];
                merged.add(idB);
              }
            }
          }
          await handle.write<NeuralStore>({
            storeId: NEURAL_STORE_ID,
            key: NEURAL_STORE_KEY,
            payload: store,
          });
          return;
        }

        throw new Error(`neural_compress: unknown method '${method}' — use quantize, prune, or distill`);
      });
    },
    {
      invariants: compressInvariants,
      cacheScope: 'store',
    },
  );
