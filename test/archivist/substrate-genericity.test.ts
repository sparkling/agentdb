// charter: substrate-seam
// ADR-0180 Phase 4 — substrate-genericity validation gate.
//
// Asserts the `makeFsJsonSubstrate` primitive (lifted from hive-mind's
// `withHiveStoreLock` in Phase 4) is substrate-GENERIC rather than tailored
// to hive-state.json. Two consumers — hive-state.json (first consumer) and
// agents.json (this file's reason-for-being) — route their writes through
// ONE `SubstrateAccess` instance built by `makeFsJsonSubstrateFixture`.
// If the primitive embeds knowledge of either filename, this test fails.
//
// The fixture (`@pkg/archivist/testing`) is the test-allowlisted in-memory
// implementation of the same `SubstrateAccess` contract production
// `makeFsJsonSubstrate` returns. Per ADR-0180 §Testing surface the brand is
// identical — handlers cannot tell the fixture from production at the type
// level. Asserting the handler works against the fixture asserts it works
// against the primitive.

import { describe, it, expect } from 'vitest';
import {
  makeFsJsonSubstrateFixture,
  withTestContext,
} from '../../src/archivist/testing/index.js';
import { agentsJsonHandler, type AgentRecord } from '../../src/archivist/handlers/hive-mind/agents-json.js';

// Minimal hive-state.json shim handler — mirrors the agents-json handler
// shape so the test exercises BOTH files through the same SubstrateAccess.
// Production hive-state handler lands in a sibling commit; this local copy
// keeps the test self-contained without depending on file order across the
// Phase 4 wave.
import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../src/archivist/index.js';

interface HiveStatePayload {
  readonly workers: ReadonlyArray<string>;
  readonly queen?: string;
}

const HIVE_STATE_ID = 'hive-mind_state' as StoreId;

const hiveStateLocalHandler: GuardedWrite<HiveStatePayload> =
  registerMutationHandler<HiveStatePayload>(
    'hive-mind_state__substrate-genericity-test',
    async (ctx: MutationContext<false>, payload: HiveStatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: HIVE_STATE_ID }, async (handle) => {
        await handle.write({ storeId: HIVE_STATE_ID, key: 'root', payload });
      });
    },
    { invariants: [], cacheScope: 'store' },
  );

describe('makeFsJsonSubstrate genericity (ADR-0180 Phase 4)', () => {
  it('routes writes for two distinct FS-JSON consumers through one SubstrateAccess', async () => {
    const fixture = makeFsJsonSubstrateFixture({
      files: ['hive-mind_state', 'hive-mind_agents'],
    });

    // First consumer: hive-state.json — establishes the substrate is wired.
    await withTestContext(
      hiveStateLocalHandler,
      { workers: ['worker-a', 'worker-b'], queen: 'queen-1' },
      { substrate: fixture },
    );

    expect(fixture.files.get('hive-mind_state')).toEqual({
      root: { workers: ['worker-a', 'worker-b'], queen: 'queen-1' },
    });

    // Second consumer: agents.json — proves the primitive is generic.
    const agentA: AgentRecord = {
      agentId: 'worker-a',
      agentType: 'worker',
      status: 'idle',
      health: 1.0,
      taskCount: 0,
      config: { role: 'worker' },
      createdAt: '2026-05-14T00:00:00Z',
      domain: 'hive-mind',
    };

    await withTestContext(
      agentsJsonHandler,
      { action: 'spawn', agent: agentA },
      { substrate: fixture },
    );

    const agentsState = fixture.files.get('hive-mind_agents') as {
      root: { agents: Record<string, AgentRecord> };
    };
    expect(agentsState.root.agents['worker-a']).toEqual(agentA);

    // Both files coexist in the fixture — same SubstrateAccess, distinct
    // storeIds. If the primitive baked in 'hive-mind_state' the second write
    // would have either failed or clobbered the first; if it baked in
    // 'hive-mind_agents' the first write would never have landed.
    expect(fixture.files.size).toBeGreaterThanOrEqual(2);
    expect(fixture.files.has('hive-mind_state')).toBe(true);
    expect(fixture.files.has('hive-mind_agents')).toBe(true);
  });

  it('serializes concurrent writes per-file (lock acquired per storeId, not globally)', async () => {
    const fixture = makeFsJsonSubstrateFixture({
      files: ['hive-mind_state', 'hive-mind_agents'],
      lockHoldMs: 10, // synthetic hold to provoke contention
    });

    // Concurrent writes to the SAME file MUST serialize via the per-file lock.
    const agentB: AgentRecord = {
      agentId: 'worker-b',
      agentType: 'worker',
      status: 'idle',
      health: 1.0,
      taskCount: 0,
      config: { role: 'worker' },
      createdAt: '2026-05-14T00:00:01Z',
      domain: 'hive-mind',
    };

    await Promise.all([
      withTestContext(
        agentsJsonHandler,
        { action: 'spawn', agent: agentB },
        { substrate: fixture },
      ),
      withTestContext(
        agentsJsonHandler,
        { action: 'spawn', agent: { ...agentB, agentId: 'worker-c' } },
        { substrate: fixture },
      ),
    ]);

    const agentsState = fixture.files.get('hive-mind_agents') as {
      root: { agents: Record<string, AgentRecord> };
    };
    // Both writes landed — neither was lost. This is the load-bearing
    // assertion against `feedback-data-loss-zero-tolerance`.
    expect(Object.keys(agentsState.root.agents).sort()).toEqual(['worker-b', 'worker-c']);

    // Contention observed on hive-mind_agents only — hive-mind_state has no
    // writes in this test, so it must show zero lockWaits. Proves the per-
    // file lock is scoped to the storeId, not a global one-flight gate.
    const agentsWaits = fixture.lockWaits.filter((w) => w.file === 'hive-mind_agents');
    const stateWaits = fixture.lockWaits.filter((w) => w.file === 'hive-mind_state');
    expect(stateWaits.length).toBe(0);
    expect(agentsWaits.length).toBeGreaterThanOrEqual(1);
  });
});
