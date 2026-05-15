// charter: dispatch
// memory_store mutation handler (ADR-0180 Phase 3, §Architecture · Audit chain).
// Registers as `GuardedWrite<MemoryStorePayload>` so every write transitions
// through the archivist's audit-chain (intent → applied | rejected) with
// guard verdicts + invariant verdicts recorded.
//
// Body wire-up is pending: the cli's `memory-tools.ts` memory_store handler
// continues to call `routeMemoryOp('store', ...)` until the dispatch boundary
// is exposed publicly (today `dispatchMutation` is intentionally not
// re-exported from `archivist/index.ts`). This file establishes the
// registration shape that the dispatch path will resolve.
//
// Invariants attach via Phase 3 invariants-author (see ADR-0180 §Mutation
// invariants — second correctness gate). The current `invariants: []` is the
// pre-invariant baseline that lets the registration land without coupling.
//
// Type-enforcement: returning `GuardedWrite<MemoryStorePayload>` from
// `registerMutationHandler` produces a branded value that the store barrel's
// `Record<string, GuardedWrite<any> | GuardedRead<any, any>>` typing accepts;
// non-branded exports fail at the boundary (ADR-0180 §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

export interface MemoryStorePayload {
  readonly namespace: string;
  readonly key: string;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
  readonly tags?: ReadonlyArray<string>;
  readonly ttl?: number;
  readonly upsert?: boolean;
  readonly generateEmbedding?: boolean;
}

const STORE_ID = 'memory_store' as StoreId;

// ADR-0181 Phase 6 — minimal substrate-backed write. The RVF substrate's
// `handle.rvf` exposes the cli's live `MemoryRvfAdapter` (cli wires it via
// `ensureRvfWired`). We call `insertAsync` with a placeholder zero-vector
// when no embedding pipeline has been wired through capabilities yet — the
// cli's higher-level routeMemoryOp path generates real embeddings; this
// handler covers the dispatched call sites whose payload doesn't carry one.
// Full RC-2 idempotency, embedding generation, and TTL semantics are
// Phase 7+ work — this minimal write is enough to make
// memory_store-dispatched call sites observable to memory_list reads
// (closes p8-inv11-delta sentinel + parity with the cli's
// `routeMemoryOp('store')` legacy path).
//
// Per `feedback-no-fallbacks`: this body is NOT silently swallowing the
// Phase 3-original "pending wire-up" throw — it's an explicit minimal
// implementation. Phase 7+ replaces this with the full RC-2 + embedding
// pipeline.
export const storeMemoryHandler: GuardedWrite<MemoryStorePayload> =
  registerMutationHandler<MemoryStorePayload>(
    'memory_store',
    async (ctx: MutationContext<false>, payload: MemoryStorePayload): Promise<void> => {
      const namespace = payload.namespace || 'default';
      const id = `${namespace}:${payload.key}`;
      const now = Date.now();

      // Generate the real embedding via the cli-wired EmbeddingScorer
      // capability (ADR-0069 unified model — Xenova/all-mpnet-base-v2,
      // 768-dim). Without a real embedding, memory_search's vector query
      // (also derived from text) would never match this insert and the
      // entry would be retrievable by exact key but invisible to semantic
      // search. `generateEmbedding: false` opts out for callers that only
      // need key-anchored storage (mostly nothing — kept for parity with
      // the cli wrapper's payload shape).
      let embedding: Float32Array;
      if (payload.generateEmbedding !== false && payload.content) {
        const scorer = ctx.capabilities.requireEmbeddingScorer();
        embedding = await scorer.embed(payload.content);
      } else {
        embedding = new Float32Array(768);
      }

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const rvfHandle = handle as { rvf?: {
          insertAsync(id: string, embedding: Float32Array, metadata?: Record<string, unknown>): Promise<void>;
        } };
        if (!rvfHandle.rvf || typeof rvfHandle.rvf.insertAsync !== 'function') {
          throw new Error(
            'archivist: memory_store — RVF substrate handle missing `rvf.insertAsync`. ' +
            'The cli must call `ensureRvfWired()` before dispatching to populate the substrate.',
          );
        }
        await rvfHandle.rvf.insertAsync(id, embedding, {
          namespace,
          key: payload.key,
          content: payload.content,
          tags: payload.tags ? [...payload.tags] : [],
          ttl: payload.ttl ?? null,
          upsert: payload.upsert ?? false,
          createdAt: now,
          updatedAt: now,
        });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'namespace',
    },
  );
