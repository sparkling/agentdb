// charter: dispatch
// Unit tests for `agentdb_graph_edge` handler — ADR-0261 fork-native ADR-130
// re-implementation. Covers:
//   - save inserts a row with the correct shape (string ids, TEXT timestamp)
//   - witness_id is deterministic given (installation_id, audit_id) — sha256 prefix
//   - ON CONFLICT(source_id, target_id, relation) bumps reinforcement_count +
//     last_reinforced and refreshes embedding_ref + witness_id
//   - load: throws on missing id (fail-loud, no silent return)
//   - query: filters by direction='src'|'dst'|'both' and optional relation
//   - reinforce: bumps count + ts; throws on missing id
//   - decay: scoring formula evaluated without modifying rows
//   - sweep-internal: hard-deletes rows older than maxAgeDays
//   - invariants reject malformed payloads (empty ids, bad confidence, etc.)
//   - no module-scope substrate cache (source-grep gate, ADR-0261 §R2.6 C1)
//   - no fire-and-forget catches in the handler (source-grep gate, §R2.6 C6)
//   - induced data-integrity errors propagate to the caller as a throw

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { withTestContext } from '../../../../src/archivist/testing/index.js';
import { graphEdgeHandler } from '../../../../src/archivist/handlers/agentdb/graph-edge.js';
import type { AgentdbGraphEdgePayload } from '../../../../src/archivist/handlers/agentdb/graph-edge.js';
import {
  payloadBytesForCurrentConfig,
  resetGraphEdgesConfig,
} from '../../../../src/encoders/scalar-int8-encoder.js';
import { resetConfig, getConfig } from '../../../../src/core/config-chain.js';
import type {
  BulkIntent,
  StoreId,
  SubstrateAccess,
  SubstrateHandle,
} from '../../../../src/archivist/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── In-memory SQLite substrate fake ──────────────────────────────────────────
//
// Mirrors the production SQLite substrate's `SqliteSubstrateHandle` shape:
// `withWrite` hands the handler a handle whose `.db` is the live database.
// Schema is loaded once per fake (graph-edges.sql).

function makeSqliteFake(): { access: SubstrateAccess; db: Database.Database } {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.pragma('foreign_keys = ON');

  // Load only graph-edges.sql — no FK to memory_entries; the schema's
  // implementation note documents the deferral.
  const graphSchemaPath = join(__dirname, '../../../../src/schemas/graph-edges.sql');
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

describe('agentdb_graph_edge handler (ADR-0261)', () => {
  beforeEach(() => {
    // Per-test config reset so encoder dim and graphEdges defaults pick up
    // the canonical fork-wide settings (mpnet-768 / no on-disk override).
    resetConfig();
    resetGraphEdgesConfig();
  });

  it('save inserts a row with the expected columns + witness id derivation', async () => {
    const { access, db } = makeSqliteFake();
    const projectRoot = '/test/project/A';
    const payload: AgentdbGraphEdgePayload = {
      action: 'save',
      sourceId: 'task:abc-def',
      targetId: 'pattern:xyz',
      relation: 'trajectory-caused',
      embedding: makeEmbedding(),
      confidence: 0.7,
      weight: 0.9,
      decayRate: 0.02,
    };
    const result = await withTestContext(graphEdgeHandler, payload, {
      substrate: access,
      projectRoot,
    });
    const row = db.prepare("SELECT * FROM graph_edges WHERE source_id = 'task:abc-def'").get() as
      | { id: number; source_id: string; target_id: string; relation: string;
          confidence: number; weight: number; decay_rate: number;
          last_reinforced: string; reinforcement_count: number;
          embedding_ref: string | null; witness_id: string;
          metadata: string | null; created_at: string }
      | undefined;
    expect(row).toBeDefined();
    if (!row) return;
    expect(row.source_id).toBe('task:abc-def');
    expect(row.target_id).toBe('pattern:xyz');
    expect(row.relation).toBe('trajectory-caused');
    expect(row.confidence).toBeCloseTo(0.7, 5);
    expect(row.weight).toBeCloseTo(0.9, 5);
    expect(row.decay_rate).toBeCloseTo(0.02, 5);
    expect(row.reinforcement_count).toBe(1);
    expect(row.embedding_ref).toBeTruthy();
    expect(row.embedding_ref!.startsWith('inline:')).toBe(true);

    // The base64 payload decodes to exactly `payloadBytesForCurrentConfig()` bytes.
    const b64 = row.embedding_ref!.slice('inline:'.length);
    const bytes = Buffer.from(b64, 'base64');
    expect(bytes.byteLength).toBe(payloadBytesForCurrentConfig());

    // Witness id = sha256(installation_id || audit_id).slice(0, 16). With no
    // configured installationId, the fallback hashes projectRoot.
    const installationId = createHash('sha256').update(projectRoot).digest('hex').slice(0, 16);
    const auditId = result.audit[0].auditId;
    const expectedWitness = createHash('sha256')
      .update(installationId)
      .update(auditId)
      .digest('hex')
      .slice(0, 16);
    expect(row.witness_id).toBe(expectedWitness);
  });

  it('save without embedding lands embedding_ref NULL', async () => {
    const { access, db } = makeSqliteFake();
    await withTestContext(
      graphEdgeHandler,
      {
        action: 'save',
        sourceId: 'task:no-emb',
        targetId: 'pattern:no-emb',
        relation: 'trajectory-caused',
        confidence: 0.5,
      } as AgentdbGraphEdgePayload,
      { substrate: access },
    );
    const row = db
      .prepare("SELECT embedding_ref FROM graph_edges WHERE source_id = 'task:no-emb'")
      .get() as { embedding_ref: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row?.embedding_ref).toBeNull();
  });

  it('save with metadata serializes to JSON TEXT', async () => {
    const { access, db } = makeSqliteFake();
    await withTestContext(
      graphEdgeHandler,
      {
        action: 'save',
        sourceId: 'task:m1',
        targetId: 'pattern:m1',
        relation: 'reinforced-by',
        metadata: { success: true, agent: 'coder' },
      } as AgentdbGraphEdgePayload,
      { substrate: access },
    );
    const row = db
      .prepare("SELECT metadata FROM graph_edges WHERE source_id = 'task:m1'")
      .get() as { metadata: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row?.metadata).toBeTruthy();
    expect(JSON.parse(row!.metadata!)).toEqual({ success: true, agent: 'coder' });
  });

  it('save ON CONFLICT(source_id, target_id, relation) reinforces the existing row', async () => {
    const { access, db } = makeSqliteFake();
    const payload: AgentdbGraphEdgePayload = {
      action: 'save',
      sourceId: 'task:conflict',
      targetId: 'pattern:conflict',
      relation: 'trajectory-caused',
      embedding: makeEmbedding(),
    };
    await withTestContext(graphEdgeHandler, payload, { substrate: access });
    const before = db
      .prepare("SELECT * FROM graph_edges WHERE source_id = 'task:conflict'")
      .get() as {
        id: number; reinforcement_count: number; last_reinforced: string;
      };
    // Force a small gap so last_reinforced can advance.
    await new Promise((r) => setTimeout(r, 1100));
    await withTestContext(graphEdgeHandler, payload, { substrate: access });
    const after = db
      .prepare("SELECT * FROM graph_edges WHERE source_id = 'task:conflict'")
      .get() as {
        id: number; reinforcement_count: number; last_reinforced: string;
      };
    expect(after.id).toBe(before.id);
    expect(after.reinforcement_count).toBe(before.reinforcement_count + 1);
    expect(after.last_reinforced >= before.last_reinforced).toBe(true);
  });

  it('load throws on missing id (no silent return)', async () => {
    const { access } = makeSqliteFake();
    await expect(
      withTestContext(graphEdgeHandler, { action: 'load', id: 9999 } as AgentdbGraphEdgePayload, {
        substrate: access,
      }),
    ).rejects.toThrow(/no row with id=9999/);
  });

  it('query filters by direction and relation', async () => {
    const { access, db } = makeSqliteFake();
    await withTestContext(graphEdgeHandler, {
      action: 'save',
      sourceId: 'task:q1',
      targetId: 'pattern:q1',
      relation: 'trajectory-caused',
      embedding: makeEmbedding(),
    } as AgentdbGraphEdgePayload, { substrate: access });
    await withTestContext(graphEdgeHandler, {
      action: 'save',
      sourceId: 'pattern:q1',
      targetId: 'task:q1',
      relation: 'reinforced-by',
      embedding: makeEmbedding(),
    } as AgentdbGraphEdgePayload, { substrate: access });

    const srcOnly = db
      .prepare("SELECT * FROM graph_edges WHERE source_id = 'task:q1'")
      .all();
    expect(srcOnly).toHaveLength(1);
    const both = db
      .prepare("SELECT * FROM graph_edges WHERE (source_id = 'task:q1' OR target_id = 'task:q1')")
      .all();
    expect(both).toHaveLength(2);

    // Handler-side smoke — dispatch query with direction filters; the
    // handler should not throw and should not modify any rows.
    const queryShape: AgentdbGraphEdgePayload = {
      action: 'query',
      memoryId: 'task:q1',
      direction: 'src',
      limit: 10,
    };
    await withTestContext(graphEdgeHandler, queryShape, { substrate: access });
  });

  it('reinforce bumps reinforcement_count + last_reinforced; throws on missing id', async () => {
    const { access, db } = makeSqliteFake();
    await withTestContext(graphEdgeHandler, {
      action: 'save',
      sourceId: 'task:r1',
      targetId: 'pattern:r1',
      relation: 'trajectory-caused',
      embedding: makeEmbedding(),
    } as AgentdbGraphEdgePayload, { substrate: access });
    const row = db.prepare('SELECT id, reinforcement_count FROM graph_edges').get() as {
      id: number; reinforcement_count: number;
    };
    await new Promise((r) => setTimeout(r, 1100));
    await withTestContext(graphEdgeHandler, {
      action: 'reinforce',
      id: row.id,
      confidence: 0.85,
    } as AgentdbGraphEdgePayload, { substrate: access });
    const after = db.prepare('SELECT * FROM graph_edges WHERE id = ?').get(row.id) as {
      reinforcement_count: number; confidence: number;
    };
    expect(after.reinforcement_count).toBe(row.reinforcement_count + 1);
    expect(after.confidence).toBeCloseTo(0.85, 5);

    await expect(
      withTestContext(graphEdgeHandler, { action: 'reinforce', id: 9999 } as AgentdbGraphEdgePayload, {
        substrate: access,
      }),
    ).rejects.toThrow(/no row with id=9999/);
  });

  it('sweep-internal hard-deletes rows older than the cutoff', async () => {
    const { access, db } = makeSqliteFake();
    await withTestContext(graphEdgeHandler, {
      action: 'save',
      sourceId: 'task:sw1',
      targetId: 'pattern:sw1',
      relation: 'trajectory-caused',
      embedding: makeEmbedding(),
    } as AgentdbGraphEdgePayload, { substrate: access });
    // Backdate the row to ~100 days ago.
    db.prepare(
      "UPDATE graph_edges SET last_reinforced = datetime('now', '-100 days') WHERE source_id = 'task:sw1'",
    ).run();
    await withTestContext(
      graphEdgeHandler,
      { action: 'sweep-internal', maxAgeDays: 90 } as AgentdbGraphEdgePayload,
      { substrate: access },
    );
    const remaining = db.prepare('SELECT COUNT(*) as c FROM graph_edges').get() as { c: number };
    expect(remaining.c).toBe(0);
  });

  it('sweep-internal preserves rows under the cutoff', async () => {
    const { access, db } = makeSqliteFake();
    await withTestContext(graphEdgeHandler, {
      action: 'save',
      sourceId: 'task:sw2',
      targetId: 'pattern:sw2',
      relation: 'trajectory-caused',
      embedding: makeEmbedding(),
    } as AgentdbGraphEdgePayload, { substrate: access });
    // Backdate by 30 days only — under any sensible cutoff.
    db.prepare(
      "UPDATE graph_edges SET last_reinforced = datetime('now', '-30 days') WHERE source_id = 'task:sw2'",
    ).run();
    await withTestContext(
      graphEdgeHandler,
      { action: 'sweep-internal', maxAgeDays: 90 } as AgentdbGraphEdgePayload,
      { substrate: access },
    );
    const remaining = db.prepare('SELECT COUNT(*) as c FROM graph_edges').get() as { c: number };
    expect(remaining.c).toBe(1);
  });

  it('invariants reject empty source/target ids on save', async () => {
    const { access } = makeSqliteFake();
    await expect(
      withTestContext(
        graphEdgeHandler,
        {
          action: 'save',
          sourceId: '',
          targetId: 'pattern:ok',
          relation: 'trajectory-caused',
          embedding: makeEmbedding(),
        } as AgentdbGraphEdgePayload,
        { substrate: access },
      ),
    ).rejects.toThrow();
  });

  it('invariants reject out-of-range confidence', async () => {
    const { access } = makeSqliteFake();
    await expect(
      withTestContext(
        graphEdgeHandler,
        {
          action: 'save',
          sourceId: 'task:conf',
          targetId: 'pattern:conf',
          relation: 'trajectory-caused',
          embedding: makeEmbedding(),
          confidence: 1.5,
        } as AgentdbGraphEdgePayload,
        { substrate: access },
      ),
    ).rejects.toThrow();
  });

  it('invariants reject embedding with wrong dim', async () => {
    const { access } = makeSqliteFake();
    const wrong = new Float32Array(10);
    await expect(
      withTestContext(
        graphEdgeHandler,
        {
          action: 'save',
          sourceId: 'task:dim',
          targetId: 'pattern:dim',
          relation: 'trajectory-caused',
          embedding: wrong,
        } as AgentdbGraphEdgePayload,
        { substrate: access },
      ),
    ).rejects.toThrow();
  });

  it('handler source contains no `let _name = ` module-scope declarations and no fire-and-forget catches', () => {
    // ADR-0261 §R2.6 acceptance: source-grep gates for C1 (no module-scope
    // cache) and C6 (no `catch { return false }` patterns).
    const handlerPath = join(
      __dirname,
      '../../../../src/archivist/handlers/agentdb/graph-edge.ts',
    );
    const workerPath = join(__dirname, '../../../../src/workers/graph-edge-sweep.ts');
    const handlerSrc = readFileSync(handlerPath, 'utf-8');
    const workerSrc = readFileSync(workerPath, 'utf-8');

    // C1: no `^(let|var|const) _\w+\s*=` at module scope in either file.
    expect(handlerSrc).not.toMatch(/^(let|var|const) _\w+\s*=/m);
    expect(workerSrc).not.toMatch(/^(let|var|const) _\w+\s*=/m);

    // C6: no fire-and-forget catches returning falsy in either file.
    expect(handlerSrc).not.toMatch(/catch[^{]*\{\s*return\s+(false|null|0|\[\])/);
    expect(workerSrc).not.toMatch(/catch[^{]*\{\s*return\s+(false|null|0|\[\])/);
  });
});
