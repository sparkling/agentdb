// charter: dispatch
// ADR-0184 structural test for the parent dispatcher in
// `handlers/hive-mind/consensus.ts`. Wave 1 introduced strategy routing; Wave
// 2 replaced bft/raft/quorum stubs with real ports. The test asserts:
//   - `'byzantine' → 'bft'` normalisation falls through to the bft handler
//   - default `'raft'` strategy is applied when caller omits the field
//   - unknown strategy hits the `default:` throw (no silent fallback)
//   - Wave 3/4/5 stubs still throw their wave-keyed `pending` messages
//   - real Wave 2 bft/raft/quorum handlers complete a propose round-trip
//     (load → mint proposal → write — verifying signature wiring, not
//     behavioural correctness, which lives in per-strategy unit tests)
//
// The test stages a `HiveStateDoc` in the fixture under `hive-mind_consensus`
// store / `root` key — every action reads/writes through that singleton key.

import { describe, expect, it } from 'vitest';
import {
  makeFsJsonSubstrateFixture,
  withTestContext,
} from '../../../../../src/archivist/testing/index.js';
import { consensusHiveMindHandler } from '../../../../../src/archivist/handlers/hive-mind/consensus.js';
import type { HiveMindConsensusPayload } from '../../../../../src/archivist/handlers/hive-mind/consensus.js';
import type { HiveStateDoc } from '../../../../../src/archivist/handlers/hive-mind/hive-state.js';

const STORE_ID = 'hive-mind_consensus';
const ROOT_KEY = 'root';

function freshHiveStateDoc(): HiveStateDoc {
  return {
    initialized: true,
    workers: ['worker-1', 'worker-2', 'worker-3'],
    workerMeta: {},
    consensus: { pending: [], history: [] },
    sharedMemory: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makePrimedFixture() {
  const fixture = makeFsJsonSubstrateFixture({ files: [STORE_ID] });
  fixture.files.set(STORE_ID, { [ROOT_KEY]: freshHiveStateDoc() });
  return fixture;
}

function proposePayload(strategy: string): HiveMindConsensusPayload {
  return {
    action: 'propose',
    type: 'test',
    value: 'wave-2',
    strategy,
  } as unknown as HiveMindConsensusPayload;
}

describe('hive-mind_consensus parent dispatcher (ADR-0184)', () => {
  it('routes strategy:bft to the bft handler (completes without throw — Wave 2 ported)', async () => {
    const fixture = makePrimedFixture();
    await expect(
      withTestContext(consensusHiveMindHandler, proposePayload('bft'), {
        substrate: fixture,
      }),
    ).resolves.toBeDefined();
  });

  it('normalises strategy:byzantine → bft (cli line 2056 parity)', async () => {
    const fixture = makePrimedFixture();
    // No throw, AND the resulting pending proposal carries strategy:'bft'.
    await withTestContext(consensusHiveMindHandler, proposePayload('byzantine'), {
      substrate: fixture,
    });
    const stored = fixture.files.get(STORE_ID) as { root: HiveStateDoc } | undefined;
    const pending = (stored?.root.consensus.pending ?? []) as Array<{ strategy: string }>;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.strategy).toBe('bft');
  });

  it('routes strategy:raft to the raft handler (Wave 2 ported)', async () => {
    const fixture = makePrimedFixture();
    await expect(
      withTestContext(consensusHiveMindHandler, proposePayload('raft'), {
        substrate: fixture,
      }),
    ).resolves.toBeDefined();
  });

  it('routes strategy:quorum to the quorum handler (Wave 2 ported)', async () => {
    const fixture = makePrimedFixture();
    await expect(
      withTestContext(consensusHiveMindHandler, proposePayload('quorum'), {
        substrate: fixture,
      }),
    ).resolves.toBeDefined();
  });

  it('routes strategy:weighted to the weighted handler (Wave 3 ported — no-queen state triggers queen-guard throw)', async () => {
    // makePrimedFixture has no queen → weighted handler throws
    // MissingQueenForWeightedConsensusError at propose. Confirms the dispatch
    // routes to the weighted body, which then enforces the propose-time guard.
    const fixture = makePrimedFixture();
    await expect(
      withTestContext(consensusHiveMindHandler, proposePayload('weighted'), {
        substrate: fixture,
      }),
    ).rejects.toThrow(/weighted strategy requires an elected queen/);
  });

  it('routes strategy:gossip to the gossip handler (Wave 4 ported)', async () => {
    const fixture = makePrimedFixture();
    await expect(
      withTestContext(consensusHiveMindHandler, proposePayload('gossip'), {
        substrate: fixture,
      }),
    ).resolves.toBeDefined();
  });

  it('routes strategy:crdt to the crdt per-strategy stub (Wave 5 pending)', async () => {
    const fixture = makePrimedFixture();
    await expect(
      withTestContext(consensusHiveMindHandler, proposePayload('crdt'), {
        substrate: fixture,
      }),
    ).rejects.toThrow(/hive-mind_consensus\[crdt\] handler body pending ADR-0184 Wave 5/);
  });

  it('defaults to raft when strategy is omitted (cli parity, Wave 2 ported)', async () => {
    const fixture = makePrimedFixture();
    await expect(
      withTestContext(
        consensusHiveMindHandler,
        { action: 'propose', type: 'test', value: 'no-strategy' } as HiveMindConsensusPayload,
        { substrate: fixture },
      ),
    ).resolves.toBeDefined();
    const stored = fixture.files.get(STORE_ID) as { root: HiveStateDoc } | undefined;
    const pending = (stored?.root.consensus.pending ?? []) as Array<{ strategy: string }>;
    expect(pending[0]?.strategy).toBe('raft');
  });

  it('throws on an unknown strategy value (no silent fallback)', async () => {
    const fixture = makePrimedFixture();
    await expect(
      withTestContext(consensusHiveMindHandler, proposePayload('mystery-strategy'), {
        substrate: fixture,
      }),
    ).rejects.toThrow(/unknown strategy/);
  });
});
