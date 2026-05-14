// charter: testing-surface
// ADR-0180 Phase 5 — contention-threshold gate (Open Follow-up #10, §Phase 5
// contention-threshold gate disposition lines ~750-755).
//
// Drives a synthetic mutation suite across multiple FS-JSON store handlers
// against `makeFsJsonSubstrateFixture` under a 5–20ms randomized lock-hold to
// provoke contention. The fixture records every wait via `lockWaits`; we then
// assert the two contractual thresholds for the 17 FS-JSON stores sharing one
// `makeFsJsonSubstrate` primitive:
//
//   1. lockWaits.length <= 1.5 * mutationCount
//      — ceiling on per-mutation contention. >1.5 means writes are queueing
//        repeatedly behind one another and the primitive has serialized work
//        that the per-file scoping should have parallelized.
//
//   2. max(lockWaits.map(w => w.waitedMs)) <= 200
//      — wall-clock tail ceiling. >200ms means some single writer waited an
//        unreasonable time for a 5–20ms hold, which would only happen if the
//        per-file mutex degenerated into a global one (regression flag).
//
// This file is the only structural gate on the contention surface; if the
// FS-JSON primitive grows a global flight gate or a per-storeId resource leak
// these two assertions fire BEFORE callers see a release.
//
// References:
//   - ADR-0180 §Migration concerns (lines ~190-220): bench/baseline.json
//     phase_5_contention block schema.
//   - test/archivist/substrate-genericity.test.ts: companion Phase 4 test that
//     asserts per-file lock scoping qualitatively; this file asserts the
//     quantitative ceiling on top of the same fixture.

import { describe, it, expect } from 'vitest';
import {
  makeFsJsonSubstrateFixture,
  withTestContext,
} from '../../src/archivist/testing/index.js';
import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../src/archivist/index.js';

// ---------------------------------------------------------------------------
// Local shim handlers — one per FS-JSON file in the suite. Each routes a
// payload write through ctx.substrate.withWrite on its own storeId, mirroring
// the production handler shape (cf. agents-json.ts). Phase 4 only ships the
// agents-json handler in the codebase; the other three files are represented
// here by minimal handlers so this gate exercises the four-file fan-out the
// production primitive will face in Phase 5.

interface ClaimsPayload {
  readonly claimId: string;
  readonly owner: string;
}
interface TasksPayload {
  readonly taskId: string;
  readonly state: string;
}
interface AgentsPayload {
  readonly agentId: string;
  readonly status: string;
}
interface SwarmPayload {
  readonly swarmId: string;
  readonly topology: string;
}

const CLAIMS_ID = 'claims.json' as StoreId;
const TASKS_ID = 'tasks.json' as StoreId;
const AGENTS_ID = 'agents.json' as StoreId;
const SWARM_ID = 'swarm.json' as StoreId;

const claimsHandler: GuardedWrite<ClaimsPayload> =
  registerMutationHandler<ClaimsPayload>(
    'claims__contention-gate',
    async (ctx: MutationContext<false>, payload: ClaimsPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: CLAIMS_ID }, async (handle) => {
        const current = await handle.read<Record<string, string>>({
          storeId: CLAIMS_ID,
          key: 'root',
        });
        const store = current ?? {};
        store[payload.claimId] = payload.owner;
        await handle.write({ storeId: CLAIMS_ID, key: 'root', payload: store });
      });
    },
    { invariants: [], cacheScope: 'store' },
  );

const tasksHandler: GuardedWrite<TasksPayload> =
  registerMutationHandler<TasksPayload>(
    'tasks__contention-gate',
    async (ctx: MutationContext<false>, payload: TasksPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: TASKS_ID }, async (handle) => {
        const current = await handle.read<Record<string, string>>({
          storeId: TASKS_ID,
          key: 'root',
        });
        const store = current ?? {};
        store[payload.taskId] = payload.state;
        await handle.write({ storeId: TASKS_ID, key: 'root', payload: store });
      });
    },
    { invariants: [], cacheScope: 'store' },
  );

const agentsHandler: GuardedWrite<AgentsPayload> =
  registerMutationHandler<AgentsPayload>(
    'agents__contention-gate',
    async (ctx: MutationContext<false>, payload: AgentsPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: AGENTS_ID }, async (handle) => {
        const current = await handle.read<Record<string, string>>({
          storeId: AGENTS_ID,
          key: 'root',
        });
        const store = current ?? {};
        store[payload.agentId] = payload.status;
        await handle.write({ storeId: AGENTS_ID, key: 'root', payload: store });
      });
    },
    { invariants: [], cacheScope: 'store' },
  );

const swarmHandler: GuardedWrite<SwarmPayload> =
  registerMutationHandler<SwarmPayload>(
    'swarm__contention-gate',
    async (ctx: MutationContext<false>, payload: SwarmPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: SWARM_ID }, async (handle) => {
        const current = await handle.read<Record<string, string>>({
          storeId: SWARM_ID,
          key: 'root',
        });
        const store = current ?? {};
        store[payload.swarmId] = payload.topology;
        await handle.write({ storeId: SWARM_ID, key: 'root', payload: store });
      });
    },
    { invariants: [], cacheScope: 'store' },
  );

describe('FS-JSON contention-threshold gate (ADR-0180 Phase 5 #10)', () => {
  it('keeps lockWaits/mutation ratio <=1.5 and max wait <=200ms under 5-20ms holds', async () => {
    const fixture = makeFsJsonSubstrateFixture({
      files: ['claims.json', 'tasks.json', 'agents.json', 'swarm.json'],
      // Phase 5 lock-hold band per ADR-0180 §Phase 5 disposition. randomized
      // per-acquire so successive holds interleave realistically.
      lockHoldMs: () => 5 + Math.random() * 15,
    });

    // ~80 mutations distributed across the four files. Per-file fan-out is
    // 20 writes each — enough to provoke serialization on the per-file mutex
    // without crossing the wall-clock ceiling under a 5-20ms hold.
    const mutationsPerFile = 20;
    const totalMutations = mutationsPerFile * 4;

    const pending: Promise<unknown>[] = [];
    for (let i = 0; i < mutationsPerFile; i++) {
      pending.push(
        withTestContext(
          claimsHandler,
          { claimId: `claim-${i}`, owner: `worker-${i}` },
          { substrate: fixture },
        ),
        withTestContext(
          tasksHandler,
          { taskId: `task-${i}`, state: i % 2 === 0 ? 'open' : 'done' },
          { substrate: fixture },
        ),
        withTestContext(
          agentsHandler,
          { agentId: `agent-${i}`, status: i % 3 === 0 ? 'busy' : 'idle' },
          { substrate: fixture },
        ),
        withTestContext(
          swarmHandler,
          { swarmId: `swarm-${i}`, topology: i % 2 === 0 ? 'mesh' : 'hierarchical' },
          { substrate: fixture },
        ),
      );
    }
    await Promise.all(pending);

    // Assertion 1 — contention ratio. lockWaits records only contended
    // acquires (waitedMs > 0), so the ratio is bounded above by writes that
    // queued behind a prior release. >1.5x means the primitive is queueing
    // beyond what per-file scoping permits.
    expect(fixture.lockWaits.length).toBeLessThanOrEqual(
      Math.floor(1.5 * totalMutations),
    );

    // Assertion 2 — wall-clock tail. With a 5-20ms hold and per-file scoping,
    // worst-case wait is hold-time × (per-file queue depth). 200ms gives
    // generous headroom for CI jitter while still flagging regressions that
    // collapse the per-file mutex into a global one.
    if (fixture.lockWaits.length > 0) {
      const maxWait = Math.max(...fixture.lockWaits.map((w) => w.waitedMs));
      expect(maxWait).toBeLessThanOrEqual(200);
    }

    // Sanity — all four files persisted their writes (no lost mutations,
    // anchors `feedback-data-loss-zero-tolerance`).
    const claimsState = fixture.files.get('claims.json') as
      | { root: Record<string, string> }
      | undefined;
    const tasksState = fixture.files.get('tasks.json') as
      | { root: Record<string, string> }
      | undefined;
    const agentsState = fixture.files.get('agents.json') as
      | { root: Record<string, string> }
      | undefined;
    const swarmState = fixture.files.get('swarm.json') as
      | { root: Record<string, string> }
      | undefined;
    expect(Object.keys(claimsState?.root ?? {})).toHaveLength(mutationsPerFile);
    expect(Object.keys(tasksState?.root ?? {})).toHaveLength(mutationsPerFile);
    expect(Object.keys(agentsState?.root ?? {})).toHaveLength(mutationsPerFile);
    expect(Object.keys(swarmState?.root ?? {})).toHaveLength(mutationsPerFile);
  });
});
