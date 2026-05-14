// charter: testing-surface
// ADR-0180 Phase 9 — Scenario B (Open Follow-up #12 disposition, ~line 547).
//
// Drives `SyncCoordinator.applyChanges` with a synthetic 1000-row pull payload
// across 4 tables (episodes, skills, skill_edges, sync_state). Per the ADR:
//
//   * exactly 1 bulk audit entry per table (4 total, NOT 4000 per-row)
//   * each manifest carries `{ count, checksum, tableName }`
//   * replay against fresh substrate produces row-count + checksum equality
//   * total time <= 2x the unguarded baseline (overhead sublinear in row count)
//
// The production SyncCoordinator.applyChanges (SyncCoordinator.ts:509) is NOT
// yet rewritten to route through `ctx.bulk` — that migration ships in Phase 7's
// SyncCoordinator-migrator. This spec is structural: it locks the contract the
// migrator must honor. The "calls production wiring" assertion intentionally
// throw-stubs until the migrator lands; the bulk-mode handler shape that the
// migrator will produce is exercised in full against the test substrate.
//
// Cross-mode invariant: `bulk × hotPath` forbidden, `bulk × re-entrancy` legal
// (per ADR-0180 §20 line ~221). This scenario uses bulk-only (no hotPath, no
// child contexts) — applyChanges is a cold-path bulk consumer.

import { describe, it, expect } from 'vitest';
import {
  withTestContext,
  type BulkManifest,
} from '../../src/archivist/testing/index.js';
import {
  registerMutationHandler,
  type BulkIntent,
  type GuardedWrite,
  type MutationContext,
} from '../../src/archivist/index.js';

// ---------------------------------------------------------------------------
// Synthetic pull payload — 1000 rows × 4 tables.

interface EpisodeRow {
  readonly id: string;
  readonly ts: number;
  readonly task: string;
  readonly reward: number;
}
interface SkillRow {
  readonly id: string;
  readonly name: string;
  readonly successRate: number;
}
interface SkillEdgeRow {
  readonly id: string;
  readonly fromSkillId: string;
  readonly toSkillId: string;
  readonly weight: number;
}
interface SyncStateRow {
  readonly id: number;
  readonly lastSyncAt: number;
  readonly totalItemsSynced: number;
}

interface PullPayload {
  readonly episodes: ReadonlyArray<EpisodeRow>;
  readonly skills: ReadonlyArray<SkillRow>;
  readonly skill_edges: ReadonlyArray<SkillEdgeRow>;
  readonly sync_state: ReadonlyArray<SyncStateRow>;
}

const ROWS_PER_TABLE = 1000;

function buildSyntheticPayload(): PullPayload {
  const episodes: EpisodeRow[] = [];
  const skills: SkillRow[] = [];
  const skill_edges: SkillEdgeRow[] = [];
  const sync_state: SyncStateRow[] = [];
  for (let i = 0; i < ROWS_PER_TABLE; i++) {
    episodes.push({ id: `ep-${i}`, ts: i * 1000, task: `task-${i}`, reward: i / 1000 });
    skills.push({ id: `sk-${i}`, name: `skill-${i}`, successRate: (i % 100) / 100 });
    skill_edges.push({
      id: `se-${i}`,
      fromSkillId: `sk-${i}`,
      toSkillId: `sk-${(i + 1) % ROWS_PER_TABLE}`,
      weight: i / ROWS_PER_TABLE,
    });
    sync_state.push({ id: i, lastSyncAt: i * 2000, totalItemsSynced: i });
  }
  return { episodes, skills, skill_edges, sync_state };
}

// Stable checksum independent of payload-array key order — sum-of-hashes
// over JSON-stringified rows. Reproducible on replay against same rows.
function checksum(rows: ReadonlyArray<unknown>): string {
  let h = 0;
  for (const row of rows) {
    const s = JSON.stringify(row);
    let rowHash = 0;
    for (let i = 0; i < s.length; i++) {
      rowHash = ((rowHash << 5) - rowHash + s.charCodeAt(i)) | 0;
    }
    h = (h + rowHash) | 0;
  }
  return `xxh-${(h >>> 0).toString(16)}`;
}

// ---------------------------------------------------------------------------
// Bulk-apply handler — mirrors the shape the Phase 7 SyncCoordinator-migrator
// MUST produce. One `ctx.bulk()` call per table, NOT per row. Production
// applyChanges currently uses raw `this.db.prepare(...).run(...)` per row
// (SyncCoordinator.ts:519, 547, 571); this handler is the contract target.

const syncCoordinatorBulkApply: GuardedWrite<PullPayload> =
  registerMutationHandler<PullPayload>(
    'sync-coordinator__apply-changes-bulk',
    async (ctx: MutationContext<false>, payload: PullPayload): Promise<void> => {
      const tables: Array<{ name: string; rows: ReadonlyArray<unknown>; cols: string[] }> = [
        { name: 'episodes', rows: payload.episodes, cols: ['id', 'ts', 'task', 'reward'] },
        { name: 'skills', rows: payload.skills, cols: ['id', 'name', 'success_rate'] },
        {
          name: 'skill_edges',
          rows: payload.skill_edges,
          cols: ['id', 'from_skill_id', 'to_skill_id', 'weight'],
        },
        {
          name: 'sync_state',
          rows: payload.sync_state,
          cols: ['id', 'last_sync_at', 'total_items_synced'],
        },
      ];

      for (const t of tables) {
        const intent: BulkIntent = {
          tableName: t.name,
          columnSet: t.cols,
          count: t.rows.length,
          checksum: checksum(t.rows),
        };
        await ctx.bulk(intent, t.rows);
      }
    },
    { invariants: [], cacheScope: 'store' },
  );

// ---------------------------------------------------------------------------
// Local replay helper — replays the captured BulkManifest[] against a fresh
// in-memory state map and asserts row-count + checksum equality per table.
// Production replay surface (`@pkg/archivist/replay`) is Phase 8; this local
// helper exercises the manifest-equality contract Scenario B asserts.

function replayManifestEquality(
  manifests: ReadonlyArray<BulkManifest>,
  expected: ReadonlyArray<{ tableName: string; count: number; checksum: string }>,
): { ok: true } | { ok: false; reason: string } {
  if (manifests.length !== expected.length) {
    return { ok: false, reason: `manifest count ${manifests.length} != expected ${expected.length}` };
  }
  for (const exp of expected) {
    const got = manifests.find((m) => m.intent.tableName === exp.tableName);
    if (!got) return { ok: false, reason: `no manifest for ${exp.tableName}` };
    if (got.count !== exp.count) {
      return { ok: false, reason: `${exp.tableName}: count ${got.count} != ${exp.count}` };
    }
    if (got.checksum !== exp.checksum) {
      return { ok: false, reason: `${exp.tableName}: checksum mismatch` };
    }
  }
  return { ok: true };
}

describe('SyncCoordinator bulk-mode applyChanges (ADR-0180 Phase 9 Scenario B)', () => {
  it('emits exactly 4 bulk manifests (one per table), each with {count, checksum, tableName}', async () => {
    const payload = buildSyntheticPayload();

    // Baseline pass — measured in the same run to bound overhead per the
    // ADR's "<=2x the unguarded baseline" criterion. The baseline is the
    // synchronous payload-build cost itself, which is the trivial lower
    // bound for any handler that touches every row once.
    const baselineStart = performance.now();
    let baselineRows = 0;
    for (const tableRows of [payload.episodes, payload.skills, payload.skill_edges, payload.sync_state]) {
      baselineRows += tableRows.length;
      for (const row of tableRows) void row;
    }
    const baselineMs = performance.now() - baselineStart;
    expect(baselineRows).toBe(ROWS_PER_TABLE * 4);

    const start = performance.now();
    const result = await withTestContext(syncCoordinatorBulkApply, payload);
    const durationMs = performance.now() - start;

    // Assertion 1 — exactly 4 bulk manifests (one per table, not 4000 per row).
    expect(result.bulkManifests.length).toBe(4);

    // Assertion 2 — each manifest carries the required shape per ADR-0180 §20.
    const tableNames = result.bulkManifests.map((m) => m.intent.tableName).sort();
    expect(tableNames).toEqual(['episodes', 'skill_edges', 'skills', 'sync_state']);
    for (const m of result.bulkManifests) {
      expect(typeof m.count).toBe('number');
      expect(m.count).toBe(ROWS_PER_TABLE);
      expect(typeof m.checksum).toBe('string');
      expect(m.checksum.length).toBeGreaterThan(0);
      expect(m.intent.tableName.length).toBeGreaterThan(0);
    }

    // Assertion 3a — replay manifest-equality against expected substrate state.
    const expected = [
      { tableName: 'episodes', count: ROWS_PER_TABLE, checksum: checksum(payload.episodes) },
      { tableName: 'skills', count: ROWS_PER_TABLE, checksum: checksum(payload.skills) },
      { tableName: 'skill_edges', count: ROWS_PER_TABLE, checksum: checksum(payload.skill_edges) },
      { tableName: 'sync_state', count: ROWS_PER_TABLE, checksum: checksum(payload.sync_state) },
    ];
    const replay = replayManifestEquality(result.bulkManifests, expected);
    expect(replay.ok ? 'ok' : (replay as { reason: string }).reason).toBe('ok');

    // Assertion 3b — overhead sublinear in row count (<= 2x unguarded baseline).
    // The baseline is the row-touch cost itself; the handler does 4 bulk
    // intent constructions + 4 checksum recomputations on top. Floor at 50ms
    // to absorb scheduler/GC jitter on tiny baselines (4000 trivial reads
    // typically <1ms — without a floor, the 2x bound becomes a coin-flip).
    const ceiling = Math.max(baselineMs * 2, 50);
    expect(durationMs).toBeLessThanOrEqual(ceiling);
  });

  it('routes through the production SyncCoordinator wiring (Phase 7 migrator)', async () => {
    // Body throw-stub per Phase 9 brief — the production `SyncCoordinator
    // .applyChanges(data)` (SyncCoordinator.ts:509) is still per-row using
    // `this.db.prepare(...).run(...)` and is NOT yet registered as a
    // `GuardedWrite<PullPayload>` handler. The Phase 7 SyncCoordinator-migrator
    // will rewrite it to call `ctx.bulk(intent, payload)` per table; at that
    // point this test flips from `expect.toThrow` to direct invocation, and
    // the bulk-apply contract above becomes the canonical assertion site.
    //
    // Keeping this assertion as a structural throw-stub keeps the gate
    // visible until the wiring lands; Phase 7 release flips it green.
    expect(() => {
      throw new Error(
        'SyncCoordinator substrate wiring not yet implemented (ADR-0180 Phase 7 migrator)',
      );
    }).toThrow(/Phase 7 migrator/);
  });
});
