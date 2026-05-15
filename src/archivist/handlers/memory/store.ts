// charter: dispatch
// memory_store mutation handler (ADR-0180 Phase 3, §Architecture · Audit chain).
// Registers as `GuardedWrite<MemoryStorePayload>` so every write transitions
// through the archivist's audit-chain (intent → applied | rejected) with
// guard verdicts + invariant verdicts recorded.
//
// ADR-0181 §C — full semantics. The handler now owns:
//   1. Embedding generation via the EmbeddingScorer capability (ADR-0069
//      unified mpnet pipeline at the cli wiring point).
//   2. ADR-0094 RC-2 idempotency guard. With `upsert:false` (default):
//      - same (namespace, key, content) → no-op (idempotent)
//      - same (namespace, key) + DIFFERENT content → throw "duplicate key"
//      - no existing entry → insert
//      With `upsert:true`: replace existing in place (preserves id); insert
//      if no existing. Mirrors the cli's `routeMemoryOp('store')` path
//      (memory-router.ts:1016-1062) which Phase 5 dispatch supersedes.
//   3. TTL → `expiresAt: now + ttl` metadata. Read handlers (cli's
//      `routeMemoryOp('get')` today; archivist `memory_retrieve` /
//      `memory_list` once Phase 7 flips them off `memory_search_index`)
//      filter expired entries on read using this field.
//
// ADR-0181 §C — scope handling NOTE. The cli wrapper at
// `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts:235-258`
// resolves the `agentMemoryScope` controller and applies the scope prefix
// to `key` BEFORE dispatching `memory_store` to the archivist. The handler
// therefore receives an ALREADY-scoped key in its payload — no separate
// `AgentMemoryScopeResolver` capability is wired here. Adding one would
// duplicate the cli's prefix logic and risk double-scoping. If a future
// caller dispatches memory_store WITHOUT going through the cli wrapper,
// scoping must be applied at that call site (the cli wrapper is the
// canonical boundary).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';
import { storeInvariants } from '../../invariants/memory/store.js';

export interface MemoryStorePayload {
  readonly namespace: string;
  readonly key: string;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
  readonly tags?: ReadonlyArray<string>;
  /**
   * Time-to-live in MILLISECONDS. When set (positive number), the handler
   * computes `expiresAt: now + ttl` and writes it to metadata. Read handlers
   * filter expired entries by comparing `expiresAt` to the current time.
   * `0`, negative, and undefined all mean "no expiry".
   */
  readonly ttl?: number;
  /**
   * RC-2 idempotency mode. `false` (default) rejects writes whose key
   * already exists with different content; `true` overwrites in place.
   * Same-content writes are no-ops regardless of this flag.
   */
  readonly upsert?: boolean;
  readonly generateEmbedding?: boolean;
}

/**
 * Narrow shape the handler reads off `rvfHandle.rvf` — exactly the methods
 * the production `MemoryRvfAdapter` exposes (see `src/adapters/memory-rvf-
 * adapter.ts`). Declared inline so the handler does not import the adapter's
 * types (handlers live in `agentdb/src/archivist/`; adapters in
 * `agentdb/src/adapters/`; the substrate-seam is the only sanctioned coupling
 * between them).
 */
interface RvfHandleShape {
  insertAsync(
    id: string,
    embedding: Float32Array,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  /**
   * ADR-0181 §C idempotency probe — present on `MemoryRvfAdapter`
   * (getByKeyAsync). The handler treats the method's absence as a wiring
   * gap and falls through to a plain insert (preserves the Phase 5 minimal
   * semantic for any non-adapter substrate path). The cli's production
   * substrate is always the adapter, so this fall-through only fires in
   * unit tests that supply a hand-rolled rvf stub.
   */
  getByKeyAsync?(
    namespace: string,
    key: string,
  ): Promise<{ readonly id: string; readonly content?: string } | null>;
  /**
   * ADR-0181 §C upsert path — `MemoryRvfAdapter.updateAsync`. Same wiring-
   * gap fallthrough as `getByKeyAsync`.
   */
  updateAsync?(
    id: string,
    update: {
      readonly content?: string;
      readonly tags?: readonly string[];
      readonly metadata?: Record<string, unknown>;
      readonly embedding?: Float32Array;
    },
  ): Promise<unknown>;
}

const STORE_ID = 'memory_store' as StoreId;

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

      // ADR-0181 §C TTL — only positive ttl yields an `expiresAt`. `0`,
      // negative, NaN, and undefined all mean "no expiry" (null).
      const ttl = payload.ttl;
      const expiresAt =
        typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 ? now + ttl : null;
      const upsert = payload.upsert ?? false;

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const rvfHandle = handle as { rvf?: RvfHandleShape };
        if (!rvfHandle.rvf || typeof rvfHandle.rvf.insertAsync !== 'function') {
          throw new Error(
            'archivist: memory_store — RVF substrate handle missing `rvf.insertAsync`. ' +
              'The cli must call `ensureRvfWired()` before dispatching to populate the substrate.',
          );
        }
        const rvf = rvfHandle.rvf;

        const baseMetadata: Record<string, unknown> = {
          namespace,
          key: payload.key,
          content: payload.content,
          tags: payload.tags ? [...payload.tags] : [],
          ttl: typeof ttl === 'number' ? ttl : null,
          expiresAt,
          upsert,
          createdAt: now,
          updatedAt: now,
        };

        // ADR-0181 §C RC-2 idempotency. Probe the existing (namespace, key)
        // via the adapter's `getByKeyAsync` — the cli's `RvfBackend.getByKey`
        // is an O(1) Map lookup, no embedding work. Branches:
        //   1. same content → no-op (idempotent; do not touch the store).
        //   2. different content + upsert:false → throw "duplicate key".
        //   3. different content + upsert:true → updateAsync (preserves id +
        //      HNSW label).
        //   4. no existing entry → fall through to insertAsync below.
        //
        // If the substrate hands us an rvf shape without `getByKeyAsync`
        // (test fakes that predate ADR-0181 §C, or a hypothetical non-
        // MemoryRvfAdapter backend), we fall through to plain insert.
        // Production cli wires the adapter, so this branch is for handler
        // unit-test ergonomics only.
        if (typeof rvf.getByKeyAsync === 'function') {
          const existing = await rvf.getByKeyAsync(namespace, payload.key);
          if (existing) {
            const existingContent = existing.content ?? '';
            const sameContent = existingContent === payload.content;

            if (sameContent) {
              // Idempotent no-op (ADR-0094 RC-2). The handler's `void` return
              // shape means the cli wrapper re-reads via `routeMemoryOp({
              // type: 'get' })` to populate the response envelope — it will
              // observe the existing entry unchanged.
              return;
            }

            if (!upsert) {
              throw new Error(
                `archivist: memory_store — duplicate key '${payload.key}' in ` +
                  `namespace '${namespace}' with different content (existing ` +
                  `length=${existingContent.length}, new length=${payload.content.length}); ` +
                  `pass \`upsert:true\` to replace. ` +
                  `(ADR-0094 RC-2 idempotency guard.)`,
              );
            }

            // Upsert path. Update in place so the existing id (and its HNSW
            // label mapping) is preserved — re-inserting under a new id
            // would orphan vector references and double-count in stats.
            if (typeof rvf.updateAsync !== 'function') {
              throw new Error(
                'archivist: memory_store — `upsert:true` requested but the RVF ' +
                  'substrate handle does not expose `updateAsync`. Wire a ' +
                  'MemoryRvfAdapter (or an equivalent VectorBackendAsync with ' +
                  'updateAsync) before dispatching upsert writes.',
              );
            }
            await rvf.updateAsync(existing.id, {
              content: payload.content,
              tags: payload.tags ? [...payload.tags] : [],
              metadata: { ...baseMetadata, updatedAt: now },
              embedding,
            });
            return;
          }
        }

        // No existing entry (or substrate doesn't support the probe) — plain
        // insert. The metadata carries `expiresAt` so read-side TTL filtering
        // has the field it needs.
        await rvf.insertAsync(id, embedding, baseMetadata);
      });
    },
    {
      invariants: storeInvariants,
      cacheScope: 'namespace',
    },
  );
