// charter: dispatch
// Per-handler unit test for `memory_store` ADR-0181 §C semantics.
//
// Covers:
//   1. EmbeddingScorer capability is invoked exactly once per write that has
//      content + generateEmbedding !== false.
//   2. ADR-0094 RC-2 idempotency:
//      a. same (namespace, key, content) → no-op (no insert, no update)
//      b. same (namespace, key) + different content + upsert:false → throws
//         with "duplicate key" + key + namespace in the error message
//      c. same (namespace, key) + different content + upsert:true → updateAsync
//         on the existing id (preserves HNSW label)
//      d. no existing entry → insertAsync
//   3. TTL semantics: positive ttl → metadata.expiresAt = now + ttl;
//      undefined/0/negative → metadata.expiresAt = null.
//   4. Fail-loud when upsert:true is requested but the substrate handle has
//      no updateAsync.

import { describe, it, expect } from 'vitest';
import {
  withTestContext,
  type WithTestContextOpts,
} from '../../../../src/archivist/testing/index.js';
import { storeMemoryHandler } from '../../../../src/archivist/handlers/memory/store.js';
import type { EmbeddingScorer } from '../../../../src/archivist/capabilities.js';
import type {
  BulkIntent,
  StoreId,
  SubstrateAccess,
  SubstrateHandle,
} from '../../../../src/archivist/types.js';

// ── RVF-shaped substrate fake (mirrors agentdb_route.test.ts shape) ─────────

interface RecordedInsert {
  readonly id: string;
  readonly embedding: Float32Array;
  readonly metadata: Record<string, unknown> | undefined;
}

interface RecordedUpdate {
  readonly id: string;
  readonly update: {
    readonly content?: string;
    readonly tags?: readonly string[];
    readonly metadata?: Record<string, unknown>;
    readonly embedding?: Float32Array;
  };
}

interface RvfFakeState {
  readonly ingest: RecordedInsert[];
  readonly updates: RecordedUpdate[];
  readonly withWriteScopes: StoreId[];
  /**
   * Pre-seeded (namespace, key) → existing entry. `getByKeyAsync` returns
   * these; the handler probes them on every write to decide RC-2 branch.
   */
  readonly existing: Map<string, { id: string; content: string }>;
}

interface MakeRvfOpts {
  readonly omitGetByKey?: boolean;
  readonly omitUpdate?: boolean;
}

function makeRvfSubstrateFake(opts: MakeRvfOpts = {}): {
  access: SubstrateAccess;
  state: RvfFakeState;
} {
  const ingest: RecordedInsert[] = [];
  const updates: RecordedUpdate[] = [];
  const withWriteScopes: StoreId[] = [];
  const existing = new Map<string, { id: string; content: string }>();

  type RvfStub = {
    insertAsync(
      id: string,
      embedding: Float32Array,
      metadata?: Record<string, unknown>,
    ): Promise<void>;
    getByKeyAsync?(
      namespace: string,
      key: string,
    ): Promise<{ id: string; content?: string } | null>;
    updateAsync?(
      id: string,
      update: {
        readonly content?: string;
        readonly tags?: readonly string[];
        readonly metadata?: Record<string, unknown>;
        readonly embedding?: Float32Array;
      },
    ): Promise<unknown>;
  };

  const rvfStub: RvfStub = {
    async insertAsync(id, embedding, metadata) {
      ingest.push({ id, embedding, metadata });
    },
  };
  if (!opts.omitGetByKey) {
    rvfStub.getByKeyAsync = async (namespace, key) => {
      return existing.get(`${namespace}:${key}`) ?? null;
    };
  }
  if (!opts.omitUpdate) {
    rvfStub.updateAsync = async (id, update) => {
      updates.push({ id, update });
      return null;
    };
  }

  const handle: SubstrateHandle & { rvf: RvfStub } = {
    rvf: rvfStub,
    async read<R>(): Promise<R | undefined> {
      throw new Error('rvf fake: handle.read is not supported');
    },
    async write(): Promise<void> {
      throw new Error('rvf fake: handle.write is not supported');
    },
    async withWrite<T>(
      scope: { storeId: StoreId },
      fn: (h: SubstrateHandle) => Promise<T>,
    ): Promise<T> {
      withWriteScopes.push(scope.storeId);
      return fn(handle);
    },
    async withBulkWrite(_intent: BulkIntent, fn: (h: SubstrateHandle) => Promise<void>): Promise<void> {
      await fn(handle);
    },
  };

  const access = handle as unknown as SubstrateAccess;
  return { access, state: { ingest, updates, withWriteScopes, existing } };
}

// ── EmbeddingScorer stub ────────────────────────────────────────────────────

function makeEmbeddingScorerStub(
  vector: Float32Array,
): EmbeddingScorer & { readonly embedCalls: ReadonlyArray<string> } {
  const embedCalls: string[] = [];
  return {
    async embed(text: string): Promise<Float32Array> {
      embedCalls.push(text);
      return vector;
    },
    cosineSimilarity(a, b): number {
      if (a.length !== b.length) throw new Error('length mismatch');
      let dot = 0;
      for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
      return dot;
    },
    get embedCalls() {
      return embedCalls;
    },
  };
}

const baseEmbedding = new Float32Array([0.1, 0.2, 0.3]);
function baseOpts(state: ReturnType<typeof makeRvfSubstrateFake>): WithTestContextOpts<false> & {
  embeddingScorer: ReturnType<typeof makeEmbeddingScorerStub>;
} {
  const scorer = makeEmbeddingScorerStub(baseEmbedding);
  return { substrate: state.access, embeddingScorer: scorer };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('memory_store handler (ADR-0181 §C semantics)', () => {
  describe('insert path (no existing entry)', () => {
    it('persists exactly one RVF record with content, namespace, key in metadata', async () => {
      const fake = makeRvfSubstrateFake();
      const opts = baseOpts(fake);

      await withTestContext(
        storeMemoryHandler,
        { namespace: 'tenant-a', key: 'k1', content: 'hello world' },
        opts,
      );

      expect(fake.state.withWriteScopes).toEqual(['memory_store']);
      expect(fake.state.ingest).toHaveLength(1);
      const [record] = fake.state.ingest;
      expect(record.id).toBe('tenant-a:k1');
      expect(record.embedding).toBe(baseEmbedding);
      expect(record.metadata).toMatchObject({
        namespace: 'tenant-a',
        key: 'k1',
        content: 'hello world',
        upsert: false,
      });
      expect(opts.embeddingScorer.embedCalls).toEqual(['hello world']);
    });

    it('defaults namespace to "default" when payload.namespace is empty', async () => {
      const fake = makeRvfSubstrateFake();
      const opts = baseOpts(fake);

      await withTestContext(
        storeMemoryHandler,
        { namespace: '', key: 'k2', content: 'v2' },
        opts,
      );

      expect(fake.state.ingest[0].id).toBe('default:k2');
      expect(fake.state.ingest[0].metadata).toMatchObject({ namespace: 'default' });
    });
  });

  describe('ADR-0094 RC-2 idempotency', () => {
    it('same (namespace, key, content) is a no-op (no insert, no update)', async () => {
      const fake = makeRvfSubstrateFake();
      fake.state.existing.set('tenant-a:k1', { id: 'existing-id', content: 'hello world' });
      const opts = baseOpts(fake);

      await withTestContext(
        storeMemoryHandler,
        { namespace: 'tenant-a', key: 'k1', content: 'hello world' },
        opts,
      );

      expect(fake.state.ingest).toEqual([]);
      expect(fake.state.updates).toEqual([]);
    });

    it('same key, DIFFERENT content, upsert:false → throws "duplicate key"', async () => {
      const fake = makeRvfSubstrateFake();
      fake.state.existing.set('tenant-a:k1', { id: 'existing-id', content: 'old value' });
      const opts = baseOpts(fake);

      await expect(
        withTestContext(
          storeMemoryHandler,
          { namespace: 'tenant-a', key: 'k1', content: 'new value' },
          opts,
        ),
      ).rejects.toThrow(/duplicate key 'k1'.*namespace 'tenant-a'.*upsert:true/s);

      expect(fake.state.ingest).toEqual([]);
      expect(fake.state.updates).toEqual([]);
    });

    it('same key, different content, upsert:true → updateAsync on existing id', async () => {
      const fake = makeRvfSubstrateFake();
      fake.state.existing.set('tenant-a:k1', { id: 'existing-id', content: 'old value' });
      const opts = baseOpts(fake);

      await withTestContext(
        storeMemoryHandler,
        {
          namespace: 'tenant-a',
          key: 'k1',
          content: 'new value',
          upsert: true,
          tags: ['t1'],
        },
        opts,
      );

      expect(fake.state.ingest).toEqual([]);
      expect(fake.state.updates).toHaveLength(1);
      const [u] = fake.state.updates;
      expect(u.id).toBe('existing-id'); // HNSW label preserved
      expect(u.update.content).toBe('new value');
      expect(u.update.tags).toEqual(['t1']);
      expect(u.update.metadata).toMatchObject({ key: 'k1', namespace: 'tenant-a' });
    });

    it('no existing entry → falls through to insertAsync', async () => {
      const fake = makeRvfSubstrateFake();
      // No existing entry pre-seeded; upsert:true should still insert.
      const opts = baseOpts(fake);

      await withTestContext(
        storeMemoryHandler,
        { namespace: 'tenant-a', key: 'k1', content: 'fresh', upsert: true },
        opts,
      );

      expect(fake.state.ingest).toHaveLength(1);
      expect(fake.state.updates).toEqual([]);
    });

    it('throws fail-loud when upsert:true requested but updateAsync absent', async () => {
      const fake = makeRvfSubstrateFake({ omitUpdate: true });
      fake.state.existing.set('tenant-a:k1', { id: 'existing-id', content: 'old' });
      const opts = baseOpts(fake);

      await expect(
        withTestContext(
          storeMemoryHandler,
          { namespace: 'tenant-a', key: 'k1', content: 'new', upsert: true },
          opts,
        ),
      ).rejects.toThrow(/upsert:true.*updateAsync/s);
    });

    it('falls through to plain insert when getByKeyAsync is absent (test-stub legacy)', async () => {
      const fake = makeRvfSubstrateFake({ omitGetByKey: true });
      const opts = baseOpts(fake);

      await withTestContext(
        storeMemoryHandler,
        { namespace: 'tenant-a', key: 'k1', content: 'v' },
        opts,
      );

      expect(fake.state.ingest).toHaveLength(1);
    });
  });

  describe('TTL semantics', () => {
    it('positive ttl yields metadata.expiresAt = now + ttl', async () => {
      const fake = makeRvfSubstrateFake();
      const opts = baseOpts(fake);

      const before = Date.now();
      await withTestContext(
        storeMemoryHandler,
        { namespace: 'n', key: 'k', content: 'v', ttl: 60_000 },
        opts,
      );
      const after = Date.now();

      const md = fake.state.ingest[0].metadata as Record<string, unknown>;
      expect(md.ttl).toBe(60_000);
      expect(typeof md.expiresAt).toBe('number');
      const exp = md.expiresAt as number;
      expect(exp).toBeGreaterThanOrEqual(before + 60_000);
      expect(exp).toBeLessThanOrEqual(after + 60_000);
    });

    it('ttl=0 → expiresAt=null (no expiry)', async () => {
      const fake = makeRvfSubstrateFake();
      const opts = baseOpts(fake);

      await withTestContext(
        storeMemoryHandler,
        { namespace: 'n', key: 'k', content: 'v', ttl: 0 },
        opts,
      );

      const md = fake.state.ingest[0].metadata as Record<string, unknown>;
      expect(md.expiresAt).toBeNull();
    });

    it('ttl=undefined → expiresAt=null, ttl=null', async () => {
      const fake = makeRvfSubstrateFake();
      const opts = baseOpts(fake);

      await withTestContext(
        storeMemoryHandler,
        { namespace: 'n', key: 'k', content: 'v' },
        opts,
      );

      const md = fake.state.ingest[0].metadata as Record<string, unknown>;
      expect(md.expiresAt).toBeNull();
      expect(md.ttl).toBeNull();
    });

    it('negative ttl → expiresAt=null (no expiry)', async () => {
      const fake = makeRvfSubstrateFake();
      const opts = baseOpts(fake);

      await withTestContext(
        storeMemoryHandler,
        { namespace: 'n', key: 'k', content: 'v', ttl: -100 },
        opts,
      );

      expect((fake.state.ingest[0].metadata as Record<string, unknown>).expiresAt).toBeNull();
    });
  });

  describe('embedding capability', () => {
    it('does not call embed() when generateEmbedding:false', async () => {
      const fake = makeRvfSubstrateFake();
      const opts = baseOpts(fake);

      await withTestContext(
        storeMemoryHandler,
        { namespace: 'n', key: 'k', content: 'v', generateEmbedding: false },
        opts,
      );

      expect(opts.embeddingScorer.embedCalls).toEqual([]);
      // Inserts a zero-vector placeholder of dim 768.
      expect(fake.state.ingest[0].embedding.length).toBe(768);
    });

    it('fail-loud when embedding scorer capability is unwired and content present', async () => {
      const fake = makeRvfSubstrateFake();
      // No embeddingScorer in opts → require* accessor throws.
      await expect(
        withTestContext(
          storeMemoryHandler,
          { namespace: 'n', key: 'k', content: 'v' },
          { substrate: fake.access },
        ),
      ).rejects.toThrow(/EmbeddingScorer/i);
    });
  });
});
