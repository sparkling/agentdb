// charter: dispatch
// Per-handler unit test for `agentdb_route` (ADR-0181 Phase 4 F4-3-callsite).
//
// Covers the two layers the un-stub wires:
//   1. `ctx.capabilities.requireTaskRouter().route(...)` produces the composed
//      RouteDecision the handler persists.
//   2. `ctx.capabilities.requireEmbeddingScorer().embed(task)` produces the
//      vector the handler hands to `rvfHandle.rvf.insertAsync(...)`.
//
// Plus the fail-loud contract: an unwired `TaskRouter` or `EmbeddingScorer`
// throws at the `require*` accessor (capability boundary), exactly as
// production behaves for an un-supplied factory in `ArchivistInitConfig`.

import { describe, it, expect } from 'vitest';
import {
  withTestContext,
  type WithTestContextOpts,
} from '../../../../src/archivist/testing/index.js';
import { agentdbRouteHandler } from '../../../../src/archivist/handlers/agentdb/route.js';
import type {
  EmbeddingScorer,
  RouteDecision,
  TaskRouter,
} from '../../../../src/archivist/capabilities.js';
import type {
  BulkIntent,
  StoreId,
  SubstrateAccess,
  SubstrateHandle,
} from '../../../../src/archivist/types.js';

// ── RVF-shaped substrate fake ────────────────────────────────────────────────
//
// The production RVF substrate (`makeRvfSubstrate`) hands handlers a handle
// whose key/value `read`/`write` throw and exposes the live `RvfBackend` on
// `.rvf`. This fake mirrors that shape: `read`/`write` throw, `withWrite`
// passes through an RVF-handle whose `.rvf.insertAsync` records the call into
// `ingest` for assertions.

interface RecordedInsert {
  readonly id: string;
  readonly embedding: Float32Array;
  readonly metadata: Record<string, unknown> | undefined;
}

interface RvfFakeState {
  readonly ingest: RecordedInsert[];
  readonly withWriteScopes: StoreId[];
}

function makeRvfSubstrateFake(): { access: SubstrateAccess; state: RvfFakeState } {
  const ingest: RecordedInsert[] = [];
  const withWriteScopes: StoreId[] = [];

  const rvfStub = {
    async insertAsync(
      id: string,
      embedding: Float32Array,
      metadata?: Record<string, unknown>,
    ): Promise<void> {
      ingest.push({ id, embedding, metadata });
    },
  };

  const handle: SubstrateHandle & { rvf: typeof rvfStub } = {
    rvf: rvfStub,
    async read<R>(_scope: { storeId: StoreId; key: string }): Promise<R | undefined> {
      throw new Error('rvf fake: handle.read is not supported');
    },
    async write<T>(_scope: { storeId: StoreId; key: string; payload: T }): Promise<void> {
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
  return { access, state: { ingest, withWriteScopes } };
}

// ── Capability stubs ─────────────────────────────────────────────────────────

function makeTaskRouterStub(decision: RouteDecision): TaskRouter & {
  readonly calls: ReadonlyArray<{
    readonly task: string;
    readonly context?: string;
    readonly namespace?: string;
  }>;
} {
  const calls: Array<{ task: string; context?: string; namespace?: string }> = [];
  return {
    async route(input): Promise<RouteDecision> {
      calls.push({ task: input.task, context: input.context, namespace: input.namespace });
      return decision;
    },
    get calls() {
      return calls;
    },
  };
}

function makeEmbeddingScorerStub(
  vector: Float32Array,
): EmbeddingScorer & {
  readonly embedCalls: ReadonlyArray<string>;
} {
  const embedCalls: string[] = [];
  return {
    async embed(text: string): Promise<Float32Array> {
      embedCalls.push(text);
      return vector;
    },
    cosineSimilarity(a: Float32Array, b: Float32Array): number {
      if (a.length !== b.length) throw new Error('length mismatch');
      let dot = 0;
      let na = 0;
      let nb = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
      }
      return dot / (Math.sqrt(na) * Math.sqrt(nb));
    },
    get embedCalls() {
      return embedCalls;
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('agentdb_route handler (ADR-0181 Phase 4 F4-3-callsite)', () => {
  it('routes via the TaskRouter capability, embeds via EmbeddingScorer, and persists one RVF record', async () => {
    const { access: rvfAccess, state: rvfState } = makeRvfSubstrateFake();
    const decision: RouteDecision = {
      route: 'memory-search',
      confidence: 0.87,
      agents: ['retrieval-specialist', 'context-builder'],
      controller: 'semanticRouter',
    };
    const router = makeTaskRouterStub(decision);
    const embedding = new Float32Array([0.1, -0.2, 0.3, 0.4]);
    const scorer = makeEmbeddingScorerStub(embedding);

    const opts: WithTestContextOpts<false> = {
      substrate: rvfAccess,
      taskRouter: router,
      embeddingScorer: scorer,
    };

    await withTestContext(
      agentdbRouteHandler,
      { task: 'recall recent decisions about indexing', context: 'caller=cli', namespace: 'tenant-a' },
      opts,
    );

    // Router invoked with the full payload, namespace defaulted from input
    expect(router.calls).toEqual([
      { task: 'recall recent decisions about indexing', context: 'caller=cli', namespace: 'tenant-a' },
    ]);

    // Scorer invoked once with the task text
    expect(scorer.embedCalls).toEqual(['recall recent decisions about indexing']);

    // withWrite targeted the correct store-id
    expect(rvfState.withWriteScopes).toEqual(['agentdb_route']);

    // Exactly one RVF record persisted, with the composed decision in metadata
    expect(rvfState.ingest).toHaveLength(1);
    const [record] = rvfState.ingest;
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.embedding).toBe(embedding);
    expect(record.metadata).toMatchObject({
      task: 'recall recent decisions about indexing',
      namespace: 'tenant-a',
      route: 'memory-search',
      confidence: 0.87,
      controller: 'semanticRouter',
      agents: ['retrieval-specialist', 'context-builder'],
      context: 'caller=cli',
    });
    // Defensive copy — handler must not retain a reference to the capability's
    // readonly agents array.
    expect(record.metadata?.agents).not.toBe(decision.agents);
  });

  it('defaults namespace to "default" when payload.namespace is omitted', async () => {
    const { access: rvfAccess, state: rvfState } = makeRvfSubstrateFake();
    const router = makeTaskRouterStub({
      route: 'general',
      confidence: 0.5,
      agents: [],
      controller: 'learningSystem',
    });
    const scorer = makeEmbeddingScorerStub(new Float32Array([1, 0, 0]));

    await withTestContext(
      agentdbRouteHandler,
      { task: 'do the thing' },
      { substrate: rvfAccess, taskRouter: router, embeddingScorer: scorer },
    );

    expect(router.calls[0].namespace).toBe('default');
    expect(rvfState.ingest[0].metadata).toMatchObject({ namespace: 'default' });
    // context omitted from payload → omitted from metadata (not stored as undefined)
    expect((rvfState.ingest[0].metadata as Record<string, unknown>).context).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(rvfState.ingest[0].metadata!, 'context')).toBe(false);
  });

  it('throws fail-loud when the TaskRouter capability is unwired', async () => {
    const { access: rvfAccess } = makeRvfSubstrateFake();
    const scorer = makeEmbeddingScorerStub(new Float32Array([1]));

    await expect(
      withTestContext(
        agentdbRouteHandler,
        { task: 'unrouted' },
        { substrate: rvfAccess, embeddingScorer: scorer },
      ),
    ).rejects.toThrow(/TaskRouter capability/i);
  });

  it('throws fail-loud when the EmbeddingScorer capability is unwired', async () => {
    const { access: rvfAccess } = makeRvfSubstrateFake();
    const router = makeTaskRouterStub({
      route: 'r',
      confidence: 0.1,
      agents: [],
      controller: 'semanticRouter',
    });

    await expect(
      withTestContext(
        agentdbRouteHandler,
        { task: 'no embedder' },
        { substrate: rvfAccess, taskRouter: router },
      ),
    ).rejects.toThrow(/EmbeddingScorer capability/i);
  });

  it('propagates RvfBackend.insertAsync failures (no silent swallow)', async () => {
    const router = makeTaskRouterStub({
      route: 'r',
      confidence: 0.5,
      agents: [],
      controller: 'semanticRouter',
    });
    const scorer = makeEmbeddingScorerStub(new Float32Array([0.5, 0.5]));

    const rvfStub = {
      async insertAsync(): Promise<void> {
        throw new Error('rvf backend: ingest failed');
      },
    };
    const handle: SubstrateHandle & { rvf: typeof rvfStub } = {
      rvf: rvfStub,
      async read<R>(): Promise<R | undefined> {
        throw new Error('not supported');
      },
      async write(): Promise<void> {
        throw new Error('not supported');
      },
      async withWrite<T>(_scope: { storeId: StoreId }, fn: (h: SubstrateHandle) => Promise<T>): Promise<T> {
        return fn(handle);
      },
      async withBulkWrite(_intent: BulkIntent, fn: (h: SubstrateHandle) => Promise<void>): Promise<void> {
        await fn(handle);
      },
    };

    await expect(
      withTestContext(
        agentdbRouteHandler,
        { task: 'will fail to persist' },
        {
          substrate: handle as unknown as SubstrateAccess,
          taskRouter: router,
          embeddingScorer: scorer,
        },
      ),
    ).rejects.toThrow(/ingest failed/);
  });
});
