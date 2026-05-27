// charter: workers
// Tests for the graph-edge sweep worker (ADR-0261 §R2.2 / §R2.6 acceptance).
//
// Covers:
//   - under-threshold row survives (no false positives in the DELETE)
//   - over-threshold row dropped (the actual GC path)
//   - per-tick substrate acquisition: source-grep gates the worker file for
//     module-scope underscore-prefixed assignments (a DB handle cache would
//     match `^(let|var|const) _\w+\s*=`)
//   - error during sweep propagates to the caller (no silent skip per
//     `feedback-best-effort-must-rethrow-fatals` / `feedback-no-fallbacks`)
//   - dispatcher receives the config-chain-derived maxAgeDays (no hardcoded 90)

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runSweepOnce } from '../../src/workers/graph-edge-sweep.js';
import { graphEdgeHandler } from '../../src/archivist/handlers/agentdb/graph-edge.js';
import { withTestContext } from '../../src/archivist/testing/index.js';
import {
  resetGraphEdgesConfig,
  getGraphEdgesConfig,
} from '../../src/encoders/scalar-int8-encoder.js';
import { resetConfig, getConfig } from '../../src/core/config-chain.js';
import type {
  BulkIntent,
  StoreId,
  SubstrateAccess,
  SubstrateHandle,
} from '../../src/archivist/types.js';
import type {
  AgentdbGraphEdgePayload,
  AgentdbGraphEdgeSweepInternalPayload,
} from '../../src/archivist/handlers/agentdb/graph-edge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// In-memory SQLite fake mirroring the production substrate's
// `withWrite` → `SqliteSubstrateHandle` shape. Mirrors the handler-test fake
// kept here (rather than re-imported) so the sweep worker test owns its
// substrate setup independently — under-threshold/over-threshold scenarios
// only need the graph_edges table.
function makeSqliteFake(): { access: SubstrateAccess; db: Database.Database } {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const graphSchemaPath = join(__dirname, '../../src/schemas/graph-edges.sql');
  db.exec(readFileSync(graphSchemaPath, 'utf-8'));
  const handle: SubstrateHandle & { db: Database.Database } = {
    db,
    async read<R>(): Promise<R | undefined> {
      throw new Error('sqlite fake: handle.read is not supported');
    },
    async write(): Promise<void> {
      throw new Error('sqlite fake: handle.write is not supported');
    },
    async withWrite<T>(_scope: { storeId: StoreId }, fn: (h: SubstrateHandle) => Promise<T>): Promise<T> {
      return fn(handle);
    },
    async withBulkWrite(_intent: BulkIntent, fn: (h: SubstrateHandle) => Promise<void>): Promise<void> {
      await fn(handle);
    },
  };
  return { access: handle as unknown as SubstrateAccess, db };
}

function makeEmbedding(): Float32Array {
  const dim = getConfig().embedding.dimension;
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.sin(i * 0.01);
  return v;
}

describe('graph-edge sweep worker (ADR-0261 §R2.2)', () => {
  beforeEach(() => {
    resetConfig();
    resetGraphEdgesConfig();
  });

  it('preserves rows under the maxAgeDays threshold', async () => {
    const { access, db } = makeSqliteFake();
    await withTestContext(
      graphEdgeHandler,
      {
        action: 'save',
        sourceId: 'task:sw-keep',
        targetId: 'pattern:sw-keep',
        relation: 'trajectory-caused',
        embedding: makeEmbedding(),
      } as AgentdbGraphEdgePayload,
      { substrate: access },
    );
    // Backdate 30 days — well under the default 90.
    db.prepare(
      "UPDATE graph_edges SET last_reinforced = datetime('now', '-30 days')",
    ).run();

    // Build a dispatcher that routes through the handler (the production
    // dispatch path); the worker exercises the same code path on every tick.
    const dispatcher = async (
      _tool: 'agentdb_graph_edge',
      payload: AgentdbGraphEdgeSweepInternalPayload,
    ): Promise<unknown> => {
      await withTestContext(graphEdgeHandler, payload as AgentdbGraphEdgePayload, {
        substrate: access,
      });
      return undefined;
    };
    await runSweepOnce(dispatcher);
    const remaining = db.prepare('SELECT COUNT(*) as c FROM graph_edges').get() as { c: number };
    expect(remaining.c).toBe(1);
  });

  it('drops rows over the maxAgeDays threshold', async () => {
    const { access, db } = makeSqliteFake();
    await withTestContext(
      graphEdgeHandler,
      {
        action: 'save',
        sourceId: 'task:sw-drop',
        targetId: 'pattern:sw-drop',
        relation: 'trajectory-caused',
        embedding: makeEmbedding(),
      } as AgentdbGraphEdgePayload,
      { substrate: access },
    );
    // Backdate 200 days — over the default 90.
    db.prepare(
      "UPDATE graph_edges SET last_reinforced = datetime('now', '-200 days')",
    ).run();
    const dispatcher = async (
      _tool: 'agentdb_graph_edge',
      payload: AgentdbGraphEdgeSweepInternalPayload,
    ): Promise<unknown> => {
      await withTestContext(graphEdgeHandler, payload as AgentdbGraphEdgePayload, {
        substrate: access,
      });
      return undefined;
    };
    await runSweepOnce(dispatcher);
    const remaining = db.prepare('SELECT COUNT(*) as c FROM graph_edges').get() as { c: number };
    expect(remaining.c).toBe(0);
  });

  it('errors during sweep propagate to the caller (no silent skip)', async () => {
    // Dispatcher rejects synchronously — the worker MUST surface the throw,
    // not swallow it. Per `feedback-best-effort-must-rethrow-fatals`.
    const failingDispatcher = async (): Promise<unknown> => {
      throw new Error('induced sweep failure');
    };
    await expect(runSweepOnce(failingDispatcher as unknown as (
      tool: 'agentdb_graph_edge',
      payload: AgentdbGraphEdgeSweepInternalPayload,
    ) => Promise<unknown>)).rejects.toThrow(/induced sweep failure/);
  });

  it('dispatches with the config-chain-derived maxAgeDays (no hardcoded 90)', async () => {
    // Capture the payload the dispatcher receives — the worker must read
    // maxAgeDays from `graphEdges.sweep.maxAgeDays` via getGraphEdgesConfig(),
    // not hardcode it. With no on-disk override, the default 90 applies.
    let observed: AgentdbGraphEdgeSweepInternalPayload | null = null;
    const observingDispatcher = async (
      _tool: 'agentdb_graph_edge',
      payload: AgentdbGraphEdgeSweepInternalPayload,
    ): Promise<unknown> => {
      observed = payload;
      return undefined;
    };
    await runSweepOnce(observingDispatcher);
    expect(observed).not.toBeNull();
    expect(observed!.action).toBe('sweep-internal');
    const cfgFromAccessor = getGraphEdgesConfig();
    expect(observed!.maxAgeDays).toBe(cfgFromAccessor.sweep.maxAgeDays);
    expect(observed!.maxAgeDays).toBe(90); // default per ADR-0261 §R2.3
  });

  it('worker source has no module-scope underscore-prefixed assignments (per-tick acquisition gate)', () => {
    // ADR-0202 / ADR-0246 / ADR-0253 C2 + ADR-0261 §R2.6 C1: the sweep
    // worker must NOT cache a substrate handle across ticks. The
    // canonical fork-side gate is a source-grep for module-scope
    // `_<name> = ` declarations — they're how the upstream
    // `let _db = null` pattern manifests.
    const workerPath = join(__dirname, '../../src/workers/graph-edge-sweep.ts');
    const src = readFileSync(workerPath, 'utf-8');
    expect(src).not.toMatch(/^(let|var|const) _\w+\s*=/m);
    // Also: no fire-and-forget catches.
    expect(src).not.toMatch(/catch[^{]*\{\s*return\s+(false|null|0|\[\])/);
  });
});
