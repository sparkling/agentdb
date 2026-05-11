/**
 * Verification for issue #150 (agentdb side of ruflo#1784 / RuVector#427).
 *
 * Covers:
 *   - ReflexionMemory.deleteEpisode removes from SQL when no vector backend
 *     is configured.
 *
 * ADR-0170 Phase B.2: ported to postgres-shaped fake backend. The
 * graph-node Cypher path retires entirely under postgres (resolution J),
 * so the previous file's GraphDatabaseAdapter Cypher-emission tests have
 * been removed alongside the graph-node retirement.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ReflexionMemory, type Episode } from '../../../src/controllers/ReflexionMemory.js';

// ---------- minimal in-memory postgres-shaped fake ----------
type Row = Record<string, any>;

class FakePostgresBackend {
  private nextEpisodeId = 1;
  episodes: Row[] = [];
  embeddings: Row[] = [];

  async exec(_sql: string): Promise<void> {
    // bootstrapSchema is a no-op in the fake
  }

  async query(sql: string, params: any[] = []): Promise<{ rows: any[]; rowCount?: number }> {
    const norm = sql.replace(/\s+/g, ' ').trim();

    if (norm.startsWith('INSERT INTO episodes')) {
      const id = this.nextEpisodeId++;
      this.episodes.push({
        id,
        ts: Math.floor(Date.now() / 1000),
        session_id: params[0],
        task: params[1],
        input: params[2],
        output: params[3],
        critique: params[4],
        reward: params[5],
        success: params[6],
        latency_ms: params[7],
        tokens_used: params[8],
        tags: params[9],
        metadata: params[10],
      });
      return { rows: [{ id }], rowCount: 1 };
    }

    if (norm.startsWith('INSERT INTO episode_embeddings')) {
      const idx = this.embeddings.findIndex((e) => e.episode_id === params[0]);
      if (idx >= 0) this.embeddings[idx] = { episode_id: params[0], embedding: params[1] };
      else this.embeddings.push({ episode_id: params[0], embedding: params[1] });
      return { rows: [], rowCount: 1 };
    }

    if (norm.startsWith('DELETE FROM episodes')) {
      const before = this.episodes.length;
      this.episodes = this.episodes.filter((e) => e.id !== params[0]);
      return { rows: [], rowCount: before - this.episodes.length };
    }

    if (norm.startsWith('DELETE FROM episode_embeddings')) {
      const before = this.embeddings.length;
      this.embeddings = this.embeddings.filter((e) => e.episode_id !== params[0]);
      return { rows: [], rowCount: before - this.embeddings.length };
    }

    if (norm.startsWith('SELECT')) {
      return { rows: [], rowCount: 0 };
    }

    throw new Error(`FakePostgresBackend: unsupported SQL: ${norm}`);
  }
}

class FakeEmbedder {
  async initialize() {}
  async embed(_text: string): Promise<Float32Array> {
    return new Float32Array([1, 0, 0]);
  }
}

describe('ReflexionMemory.deleteEpisode (issue #150)', () => {
  let db: FakePostgresBackend;
  let mem: ReflexionMemory;

  beforeEach(() => {
    ReflexionMemory._resetSingleton();
    db = new FakePostgresBackend();
    mem = new ReflexionMemory(db as any, new FakeEmbedder() as any);
  });

  it('removes the episode and its embedding from SQL', async () => {
    const epId = await mem.storeEpisode({
      sessionId: 's1',
      task: 'demo',
      reward: 0.9,
      success: true,
    } as Episode);

    expect(db.episodes.find((e) => e.id === epId)).toBeDefined();
    expect(db.embeddings.find((e) => e.episode_id === epId)).toBeDefined();

    const removed = await mem.deleteEpisode(epId);
    expect(removed).toBe(true);
    expect(db.episodes.find((e) => e.id === epId)).toBeUndefined();
    expect(db.embeddings.find((e) => e.episode_id === epId)).toBeUndefined();
  });

  it('returns false when the episode does not exist', async () => {
    const removed = await mem.deleteEpisode(99999);
    expect(removed).toBe(false);
  });

  it('accepts numeric and string ids interchangeably', async () => {
    const epId = await mem.storeEpisode({
      sessionId: 's1',
      task: 't',
      reward: 1,
      success: true,
    } as Episode);
    const removed = await mem.deleteEpisode(String(epId));
    expect(removed).toBe(true);
  });
});
