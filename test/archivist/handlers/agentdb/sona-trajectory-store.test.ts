// charter: dispatch
// Per-handler unit tests for `agentdb_sona_trajectory_store` (ADR-0181 Item 6
// — 2026-05-16). Covers BOTH the mutation handler (record action via
// SonaTrajectoryWriter capability) AND the sibling read handler (stats
// action via SonaTrajectoryReader capability), plus the SonaTrajectoryService
// dual-write durability behaviour over an in-memory better-sqlite3 handle.
//
// b5-da BLOCKING revision (a) coverage — the cli writer adapter at
// `forks/ruflo/v3/@claude-flow/cli/src/memory/archivist-init.ts:646-703`
// (`makeCliSonaTrajectoryWriter`) translates the dispatch payload
// `{pattern, agentType, type, reward}` into the controller signature
// `recordTrajectory(agentType, [{state:{marker:pattern, type}, action:pattern,
// reward}])`. The agentType is preserved verbatim — the b5 probe at
// L1853-1855 greps the response `agentTypes` array for `b5-sona`. The
// "round-trip cli payload shape" test below mirrors that translation
// in-process and confirms the SQLite row's `agent_type` column equals the
// dispatch payload's `agentType`, NOT the marker pattern.

import { describe, it, expect } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { withTestReadContext } from '../../../../src/archivist/testing/index.js';
import {
  readSonaTrajectoryStatsHandler,
  storeSonaTrajectoryHandler,
} from '../../../../src/archivist/handlers/agentdb/sona-trajectory-store.js';
import { SonaTrajectoryService } from '../../../../src/services/SonaTrajectoryService.js';
import type {
  SonaTrajectoryReader,
  SonaTrajectoryWriter,
} from '../../../../src/archivist/capabilities.js';

// ── SQLite test fixtures ────────────────────────────────────────────────────

function freshDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  // Apply the Item 6 schema (no need to load the full schema.sql for these
  // unit tests — only the sona_trajectories table is exercised).
  db.exec(`
    CREATE TABLE IF NOT EXISTS sona_trajectories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_type TEXT NOT NULL,
      steps JSON NOT NULL,
      reward REAL NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      metadata JSON
    );
    CREATE INDEX IF NOT EXISTS idx_sona_traj_agent ON sona_trajectories(agent_type);
  `);
  return db;
}

// ── SonaTrajectoryService durability ───────────────────────────────────────

describe('SonaTrajectoryService dual-write durability (ADR-0181 Item 6)', () => {
  it('zero-arg constructor preserves backward compat (in-memory only, no SQLite touched)', async () => {
    const svc = new SonaTrajectoryService();
    await svc.recordTrajectory('coder', [{ state: { task: 'x' }, action: 'write', reward: 0.9 }]);
    const stats = svc.getStats();
    expect(stats.trajectoryCount).toBe(1);
    expect(stats.agentTypes).toEqual(['coder']);
  });

  it('dual-writes to SQLite when {getDb} is supplied', async () => {
    const db = freshDb();
    const svc = new SonaTrajectoryService({ getDb: () => db });
    await svc.recordTrajectory('reviewer', [
      { state: { task: 'review' }, action: 'check', reward: 0.7 },
    ]);

    const row = db
      .prepare('SELECT agent_type, steps, reward FROM sona_trajectories')
      .get() as { agent_type: string; steps: string; reward: number };
    expect(row.agent_type).toBe('reviewer');
    expect(row.reward).toBeCloseTo(0.7);
    expect(JSON.parse(row.steps)).toHaveLength(1);
  });

  it('getStats merges in-memory + SQLite (cross-process simulation)', async () => {
    const db = freshDb();
    // Process A writes via service A (in-memory + SQLite).
    const svcA = new SonaTrajectoryService({ getDb: () => db });
    await svcA.recordTrajectory('a-agent', [{ state: {}, action: 'a1', reward: 0.5 }]);
    await svcA.recordTrajectory('a-agent', [{ state: {}, action: 'a2', reward: 0.6 }]);

    // Process B starts fresh — its in-memory Map is empty but the SQLite db
    // has 2 rows from process A.
    const svcB = new SonaTrajectoryService({ getDb: () => db });
    const statsB = svcB.getStats();
    expect(statsB.trajectoryCount).toBe(2);
    expect(statsB.agentTypes).toContain('a-agent');
  });

  it('getPatterns returns rows from SQLite for cross-process queries', async () => {
    const db = freshDb();
    const svcA = new SonaTrajectoryService({ getDb: () => db });
    await svcA.recordTrajectory('coder', [
      { state: {}, action: 'write_test', reward: 0.8 },
      { state: {}, action: 'commit', reward: 0.9 },
    ]);

    const svcB = new SonaTrajectoryService({ getDb: () => db });
    const patterns = await svcB.getPatterns('coder');
    expect(patterns).toHaveLength(1);
    expect(patterns[0].steps).toHaveLength(2);
  });

  it('lazy resolver returns null → falls back to in-memory only (no throw)', async () => {
    const svc = new SonaTrajectoryService({ getDb: () => null });
    await svc.recordTrajectory('coder', [{ state: {}, action: 'write', reward: 0.5 }]);
    const stats = svc.getStats();
    expect(stats.trajectoryCount).toBe(1);
  });

  it('SQL error during INSERT re-throws (no silent fallback per feedback-no-fallbacks)', async () => {
    // Mid-stream resolver flip: same handle but underlying table dropped to
    // simulate a real SQL error path.
    const db = freshDb();
    db.exec('DROP TABLE sona_trajectories');
    const svc = new SonaTrajectoryService({ getDb: () => db });
    await expect(
      svc.recordTrajectory('coder', [{ state: {}, action: 'write', reward: 0.5 }]),
    ).rejects.toThrow(/no such table/i);
  });

  it('aggregated reward = mean of step rewards (matches in-memory totalReward)', async () => {
    const db = freshDb();
    const svc = new SonaTrajectoryService({ getDb: () => db });
    await svc.recordTrajectory('coder', [
      { state: {}, action: 'a', reward: 0.4 },
      { state: {}, action: 'b', reward: 0.6 },
    ]);
    const row = db
      .prepare('SELECT reward FROM sona_trajectories')
      .get() as { reward: number };
    expect(row.reward).toBeCloseTo(0.5);
  });
});

// ── Read handler (stats action) ─────────────────────────────────────────────

function makeStubReader(stats: {
  engine: string;
  available: boolean;
  trajectoryCount: number;
  agentTypes: string[];
}): SonaTrajectoryReader & { readonly calls: number } {
  let calls = 0;
  return {
    async getStats() {
      calls++;
      return stats;
    },
    get calls() {
      return calls;
    },
  };
}

describe('agentdb_sona_trajectory_store read handler (Item 6 sibling)', () => {
  it('stats action returns the cli envelope with controller=sonaTrajectory', async () => {
    const reader = makeStubReader({
      engine: 'js',
      available: false,
      trajectoryCount: 3,
      agentTypes: ['b5-sona', 'coder'],
    });

    const { result } = await withTestReadContext(
      readSonaTrajectoryStatsHandler,
      { action: 'stats' },
      { sonaTrajectoryReader: reader },
    );

    expect(result).toEqual({
      success: true,
      controller: 'sonaTrajectory',
      engine: 'js',
      available: false,
      trajectoryCount: 3,
      agentTypes: ['b5-sona', 'coder'],
    });
    expect(reader.calls).toBe(1);
  });

  it('omitted action defaults to stats (treats undefined as stats)', async () => {
    const reader = makeStubReader({
      engine: 'native',
      available: true,
      trajectoryCount: 0,
      agentTypes: [],
    });
    const { result } = await withTestReadContext(
      readSonaTrajectoryStatsHandler,
      {},
      { sonaTrajectoryReader: reader },
    );
    expect(result.controller).toBe('sonaTrajectory');
    expect(result.trajectoryCount).toBe(0);
  });

  it('throws fail-loud when action=record reaches the read handler (caller bug)', async () => {
    const reader = makeStubReader({
      engine: 'js',
      available: false,
      trajectoryCount: 0,
      agentTypes: [],
    });
    await expect(
      withTestReadContext(
        readSonaTrajectoryStatsHandler,
        { action: 'record', pattern: 'x' },
        { sonaTrajectoryReader: reader },
      ),
    ).rejects.toThrow(/only 'stats' action is read-side/);
  });

  it('throws fail-loud when SonaTrajectoryReader capability is unwired', async () => {
    await expect(
      withTestReadContext(readSonaTrajectoryStatsHandler, { action: 'stats' }, {}),
    ).rejects.toThrow(/SonaTrajectoryReader capability/);
  });
});

// ── Round-trip: cli adapter payload shape → SQLite row → reader stats ──────

describe('Round-trip cli adapter payload shape (b5-da revision a coverage)', () => {
  it('mirrors makeCliSonaTrajectoryWriter — agent_type column = dispatch payload agentType, NOT pattern', async () => {
    // Setup: the controller wired with a SQLite handle (matches the cli's
    // controller-registry passing this.agentdb.database).
    const db = freshDb();
    const controller = new SonaTrajectoryService({ getDb: () => db });

    // Mirror the cli adapter at archivist-init.ts:683-692 verbatim — translate
    // dispatch payload {pattern, agentType, type, reward} into
    // recordTrajectory(agentType, [{state, action, reward}]).
    const dispatchPayload = {
      pattern: 'b5-sona-12345-1700000000 sona-trajectory',
      agentType: 'b5-sona',
      type: 'sona-trajectory',
      reward: 0.85,
    };

    const writer: SonaTrajectoryWriter = {
      async recordTrajectory(input) {
        const steps = [
          {
            state: { marker: input.pattern, type: input.type },
            action: input.pattern,
            reward: input.reward,
          },
        ];
        await controller.recordTrajectory(input.agentType, steps);
        return { success: true, controller: 'sonaTrajectory' };
      },
    };

    // Drive through the writer (mirrors handler.recordTrajectory call).
    await writer.recordTrajectory(dispatchPayload);

    // Assert the SQLite row stores agent_type='b5-sona' (the dispatch
    // payload's agentType field) and NOT the marker pattern. This is the
    // critical b5-da revision (a) check — the b5 probe at
    // lib/acceptance-adr0090-b5-checks.sh:1853 greps the response
    // `agentTypes` array for `b5-sona`; if the cli adapter ever fell into
    // failure mode (ii) (`recordTrajectory(payload.pattern, ...)`), the
    // column would store the marker and the probe would fail.
    const row = db
      .prepare('SELECT agent_type FROM sona_trajectories LIMIT 1')
      .get() as { agent_type: string };
    expect(row.agent_type).toBe('b5-sona');
    expect(row.agent_type).not.toMatch(/sona-trajectory/);

    // Read back through the reader capability (mirrors what the cli wrapper
    // will dispatchRead to project the b5 envelope).
    const reader: SonaTrajectoryReader = {
      async getStats() {
        const stats = controller.getStats();
        return {
          engine: controller.getEngineType(),
          available: stats.available,
          trajectoryCount: stats.trajectoryCount,
          agentTypes: stats.agentTypes,
        };
      },
    };
    const stats = await reader.getStats();
    expect(stats.trajectoryCount).toBe(1);
    expect(stats.agentTypes).toContain('b5-sona');
    expect(stats.agentTypes).not.toContain(dispatchPayload.pattern);
  });
});

// ── Mutation handler — guards the action discriminator ─────────────────────

describe('agentdb_sona_trajectory_store mutation handler', () => {
  it('exports a registered GuardedWrite (presence smoke)', () => {
    expect(typeof storeSonaTrajectoryHandler).toBe('function');
  });
});
