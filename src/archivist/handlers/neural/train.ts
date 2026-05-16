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

import { registerMutationHandler } from '../../registration.js';
import type { MutationContext } from '../../mutation-context.js';
import type { GuardedWrite, StoreId } from '../../types.js';
import { trainInvariants } from '../../invariants/neural/train.js';

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

/** Extract a meaningful pattern label from a training entry (ports ADR-093 F11
 *  from cli neural-tools.ts) — prefer semantic fields over a raw JSON dump. */
function deriveLabel(entry: unknown, modelType: NeuralModelType, index: number): string {
  if (typeof entry === 'string') {
    return entry.slice(0, 80);
  }
  if (entry && typeof entry === 'object') {
    const e = entry as Record<string, unknown>;
    const labelField = e.label ?? e.category ?? e.class ?? e.tag ?? e.intent ?? e.name ?? e.title;
    if (typeof labelField === 'string' && labelField.length > 0) {
      return labelField.slice(0, 80);
    }
    const summaryField = e.text ?? e.input ?? e.task ?? e.description ?? e.content;
    if (typeof summaryField === 'string' && summaryField.length > 0) {
      return `${summaryField.slice(0, 60)}${summaryField.length > 60 ? '…' : ''}`;
    }
  }
  return `${modelType}:entry-${index}`;
}

/** Resolve the embeddable text of a training entry (ports cli neural-tools.ts). */
function deriveText(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const e = entry as Record<string, unknown>;
    const text = e.text ?? e.content ?? e.label;
    if (typeof text === 'string' && text.length > 0) return text;
  }
  return JSON.stringify(entry);
}

// Ports the cli `neural_train` body (neural-tools.ts). The cli's
// `loadNeuralStore → mint model → embed-each(data) → saveNeuralStore` collapses
// to one `ctx.substrate.withWrite`. The embed-each step uses the
// `EmbeddingScorer` capability threaded onto `MutationContext` (ADR-0180 F4-2
// Phase C) — `ctx.capabilities.requireEmbeddingScorer()` fails loud if the
// `embeddingScorerFactory` was not wired into `ArchivistInitConfig`, which is
// the intended substitute for the cli's in-process `generateEmbedding` Tier
// chain. `neural` is an FS-JSON family store, so `ctx.substrate` resolves.
export const trainNeuralHandler: GuardedWrite<NeuralTrainPayload> =
  registerMutationHandler<NeuralTrainPayload>(
    'neural_train',
    async (ctx: MutationContext<false>, payload: NeuralTrainPayload): Promise<void> => {
      const embedder = ctx.capabilities.requireEmbeddingScorer();
      await ctx.substrate.withWrite({ storeId: NEURAL_STORE_ID }, async (handle) => {
        const current = await handle.read<NeuralStore>({
          storeId: NEURAL_STORE_ID,
          key: NEURAL_STORE_KEY,
        });
        const store: NeuralStore = current ?? { models: {}, patterns: {}, version: '3.0.0' };

        const modelId =
          payload.modelId ?? `model-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const modelType = payload.modelType;
        const epochs = payload.epochs ?? 10;

        const model: NeuralModel = {
          id: modelId,
          name: `${modelType}-model`,
          type: modelType,
          status: 'training',
          accuracy: 0,
          epochs,
          config: {
            learningRate: payload.learningRate ?? 0.001,
            batchSize: 32,
          },
        };
        store.models[modelId] = model;

        const trainingData = payload.data;
        let patternsStored = 0;
        if (trainingData !== undefined && trainingData !== null) {
          const entries = Array.isArray(trainingData) ? trainingData : [trainingData];
          for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const text = deriveText(entry);
            if (!text) continue;

            const embedding = Array.from(await embedder.embed(text));
            const patternId = `${modelId}-train-${i}`;
            store.patterns[patternId] = {
              id: patternId,
              name: deriveLabel(entry, modelType, i),
              type: modelType,
              embedding,
              metadata: { modelId, epoch: epochs, index: i, raw: entry },
              createdAt: new Date().toISOString(),
              usageCount: 0,
            };
            patternsStored++;
          }
        }

        model.status = 'ready';
        model.accuracy = patternsStored > 0 ? 1.0 : 0;
        model.trainedAt = new Date().toISOString();

        await handle.write<NeuralStore>({
          storeId: NEURAL_STORE_ID,
          key: NEURAL_STORE_KEY,
          payload: store,
        });
      });
    },
    {
      invariants: trainInvariants,
      cacheScope: 'store',
    },
  );
