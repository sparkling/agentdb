// charter: substrate-seam
//
// ADR-0180 Open Follow-up #10 — `makeRvfSubstrate` primitive.
//
// RVF native substrate. Atomicity, fsync, and crash-safe `.rvf` persistence are
// owned by the Rust crate at the N-API boundary (RvfBackend.save() → flush() +
// db.compact(); ingest via db.ingestBatch()). Per ADR-0180 §Migration concerns
// Phase 4 (lines 469, 519): the JS layer must NOT add a tmp+rename dance or its
// own O_EXCL lock — doing so would duplicate the crate's internal serialization
// and race the `pending` queue flush (RvfBackend.ts pending splice in flush()).
//
// `withWrite` is therefore a thin pass-through: it hands the handler an inner
// SubstrateHandle exposing `{ rvf: backend }` and returns `await fn(handle)`.
// There is no post-commit cache hook here (the cache asymmetry vs.
// makeFsJsonSubstrate is intentional and documented in MODULE.md per ADR-0180
// §Recommendation line 521 — RVF's `cachedCount++` is already wired inside the
// backend, line 310).
//
// `withBulkWrite` delegates to `withWrite`: `db.ingestBatch()` is internally
// serialized by the crate, so bulk semantics collapse to a single pass-through.
// The archivist emits the one-entry bulk manifest a layer up; this substrate
// only forwards.

import { makeSubstrateAccess } from '../substrate-internal.js';
import type {
  BulkIntent,
  ReadCapableSubstrate,
  StoreId,
  SubstrateAccess,
  SubstrateHandle,
} from '../types.js';
import type { RvfBackend } from '../../backends/rvf/RvfBackend.js';

// ── Handle augmentation ──────────────────────────────────────────────────────
//
// The base `SubstrateHandle` is substrate-agnostic and key/value-shaped. RVF is
// vector-addressed, not key/value — `read`/`write` throw on this handle. The RVF
// substrate instead exposes the live `RvfBackend` on `.rvf` so handlers run
// vector ingest/search directly. Handlers that target RVF narrow the handle to
// `RvfSubstrateHandle` to reach `.rvf` (mirrors `SqliteSubstrateHandle.db`).

export interface RvfSubstrateHandle extends SubstrateHandle {
  /** The live `RvfBackend`, valid only inside `withWrite`/`withBulkWrite`. */
  readonly rvf: RvfBackend;
}

// ── Public factory ───────────────────────────────────────────────────────────

/**
 * Build an RVF `SubstrateAccess` over an `RvfBackend` instance.
 *
 * The inner `SubstrateHandle` delivered to `withWrite`/`withBulkWrite` handlers
 * carries `{ rvf: backend }` so handlers reach the native backend directly. The
 * crate owns atomicity + fsync + crash-safety, so `withWrite` adds no JS-side
 * exclusion — it is a pass-through that returns `await fn(handle)`.
 *
 * The returned handle also carries the read-only `query` / `vectorSearch`
 * surface (`ReadCapableSubstrate`) consumed by the read-dispatch router:
 *   - `vectorSearch({ storeId, vector, topK })` is the native RVF operation —
 *     it delegates to `RvfBackend.searchAsync` (HNSW similarity) and maps each
 *     `SearchResult` to `{ item, score }` where `score` is the normalized
 *     similarity.
 *   - `query({ storeId, predicate })` throws: `RvfBackend` exposes no
 *     metadata-only filter scan — every RVF read is vector-anchored. A
 *     vectorless predicate scan routed to an RVF store is a misroute (the
 *     caller wants `vectorSearch`, or the store should classify to FS-JSON /
 *     the SQLite carve-out).
 *
 * @example
 *   const substrate = makeRvfSubstrate(rvfBackend);
 *   await substrate.withWrite({ storeId }, async (handle) => {
 *     await (handle as RvfSubstrateHandle).rvf.insertBatchAsync(items);
 *   });
 */
export function makeRvfSubstrate(backend: RvfBackend): SubstrateAccess {
  // The handle satisfies SubstrateHandle (so it threads through the branded
  // SubstrateAccess type) while also exposing `rvf` per ADR-0180 OF#10. Handlers
  // that need the native backend narrow to `RvfSubstrateHandle`.
  const handle: RvfSubstrateHandle & ReadCapableSubstrate = {
    rvf: backend,

    async read<R>(scope: { storeId: StoreId; key: string }): Promise<R | undefined> {
      // RVF is vector-addressed, not key/value. Whole-document read is not part
      // of the RVF substrate contract — handlers query the backend directly.
      void scope;
      throw new Error(
        'makeRvfSubstrate: handle.read is not supported — use the RvfBackend on `handle.rvf` for vector queries',
      );
    },

    async write<T>(scope: { storeId: StoreId; key: string; payload: T }): Promise<void> {
      void scope;
      throw new Error(
        'makeRvfSubstrate: handle.write is not supported — use the RvfBackend on `handle.rvf` for ingest',
      );
    },

    async withWrite<T>(
      scope: { storeId: StoreId },
      fn: (h: SubstrateHandle) => Promise<T>,
    ): Promise<T> {
      // Thin pass-through: the Rust crate owns atomicity + fsync + crash-safety
      // at the N-API boundary. A JS-layer lock would duplicate crate-internal
      // serialization and race the backend's `pending` queue flush.
      void scope.storeId;
      return await fn(handle);
    },

    async withBulkWrite(
      intent: BulkIntent,
      fn: (h: SubstrateHandle) => Promise<void>,
    ): Promise<void> {
      // `db.ingestBatch()` is internally serialized by the crate, so bulk
      // collapses to withWrite. The archivist owns the bulk-manifest audit
      // emission one layer up; this substrate only forwards.
      void intent;
      await this.withWrite({ storeId: intent.tableName as StoreId }, fn);
    },

    // ── Read-only surface (ReadCapableSubstrate) ─────────────────────────────

    async query<R>(scope: { storeId: StoreId; predicate: unknown }): Promise<ReadonlyArray<R>> {
      // Throw-by-design: `RvfBackend` exposes no metadata-only filter scan —
      // the native `db.query(...)` surface is vector-anchored (HNSW), and a
      // vectorless predicate scan over an RVF segment is not an operation the
      // crate provides. A `query` routed to an RVF-family storeId is a
      // misroute: the caller either wants `vectorSearch` (vector-anchored), or
      // the store should classify to FS-JSON / the SQLite carve-out. Fail loud
      // rather than silent-empty (`feedback-no-fallbacks`).
      void scope.predicate;
      throw new Error(
        `makeRvfSubstrate: query (vectorless predicate scan) is not available — store ` +
          `'${scope.storeId as string}' resolves to the RVF substrate, which is vector-addressed only. ` +
          `Use vectorSearch for a vector-anchored query, or route relational/document reads elsewhere.`,
      );
    },

    async vectorSearch<R>(scope: {
      storeId: StoreId;
      vector: Float32Array;
      topK: number;
    }): Promise<ReadonlyArray<{ item: R; score: number }>> {
      // Native RVF operation: HNSW similarity via `RvfBackend.searchAsync`,
      // which flushes pending writes first so results are current. Each
      // `SearchResult` carries `{ id, distance, similarity, metadata }`; we map
      // `item` to the full result record and `score` to the normalized
      // similarity (0-1, higher = closer) per the `ReadOnlySubstrateHandle`
      // contract.
      const results = await backend.searchAsync(scope.vector, scope.topK);
      return results.map((r) => ({
        item: r as unknown as R,
        score: r.similarity,
      }));
    },
  };

  return makeSubstrateAccess(handle);
}
