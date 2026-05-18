// charter: dispatch
// ADR-0184 Wave 2 — raft strategy behavioural tests.

import { describe, expect, it } from 'vitest';
import {
  makeFsJsonSubstrateFixture,
  withTestContext,
  type FsJsonSubstrateFixture,
} from '../../../../../src/archivist/testing/index.js';
import { consensusHiveMindHandler } from '../../../../../src/archivist/handlers/hive-mind/consensus.js';
import type { HiveMindConsensusPayload } from '../../../../../src/archivist/handlers/hive-mind/consensus.js';
import type { HiveStateDoc } from '../../../../../src/archivist/handlers/hive-mind/hive-state.js';
import type { ConsensusProposal, ConsensusHistoryRow } from '../../../../../src/archivist/handlers/hive-mind/consensus/_shared.js';

const STORE_ID = 'hive-mind_consensus';
const ROOT_KEY = 'root';

function freshState(workerIds: string[] = ['w1', 'w2', 'w3']): HiveStateDoc {
  return {
    initialized: true,
    workers: workerIds,
    workerMeta: {},
    consensus: { pending: [], history: [] },
    sharedMemory: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeFixture(state: HiveStateDoc): FsJsonSubstrateFixture {
  const fixture = makeFsJsonSubstrateFixture({ files: [STORE_ID] });
  fixture.files.set(STORE_ID, { [ROOT_KEY]: state });
  return fixture;
}

function readState(fixture: FsJsonSubstrateFixture): HiveStateDoc {
  const stored = fixture.files.get(STORE_ID) as { root: HiveStateDoc } | undefined;
  if (!stored) throw new Error('test: state not present in fixture');
  return stored.root;
}

async function dispatch(fixture: FsJsonSubstrateFixture, payload: HiveMindConsensusPayload): Promise<void> {
  await withTestContext(consensusHiveMindHandler, payload, { substrate: fixture });
}

describe('raft.propose (ADR-0184 Wave 2)', () => {
  it('mints a pending proposal with term and timeoutAt', async () => {
    const fixture = makeFixture(freshState());
    await dispatch(fixture, {
      action: 'propose',
      type: 'test',
      value: 'v',
      strategy: 'raft',
      term: 7,
      timeoutMs: 30_000,
      proposalId: 'p1',
    });
    const proposal = (readState(fixture).consensus.pending as ConsensusProposal[])[0]!;
    expect(proposal.strategy).toBe('raft');
    expect(proposal.term).toBe(7);
    expect(proposal.timeoutAt).toBeDefined();
    expect(proposal.byzantineVoters).toBeUndefined();
    expect(proposal.quorumPreset).toBeUndefined();
  });

  it('throws RaftTermCollisionError when same term has a pending proposal', async () => {
    const fixture = makeFixture(freshState());
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'raft',
      term: 3, proposalId: 'p1',
    });
    await expect(
      dispatch(fixture, {
        action: 'propose', type: 't', value: 'v', strategy: 'raft',
        term: 3, proposalId: 'p2',
      }),
    ).rejects.toThrow(/Raft term 3 already has a pending proposal: p1/);
  });
});

describe('raft.vote (ADR-0184 Wave 2)', () => {
  it('records vote and resolves to approved when majority (floor(N/2)+1) reached', async () => {
    // floor(3/2)+1 = 2 → 2 yes votes approves at N=3.
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'raft', proposalId: 'p1',
    });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'raft' });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w2', vote: true, strategy: 'raft' });
    const state = readState(fixture);
    expect(state.consensus.pending).toHaveLength(0);
    const history = state.consensus.history as ConsensusHistoryRow[];
    expect(history[0]?.result).toBe('approved');
    expect(history[0]?.strategy).toBe('raft');
  });

  it('throws RaftVoteChangeError on double-vote (Raft is single-vote-per-term)', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'raft', proposalId: 'p1', term: 1,
    });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'raft' });
    await expect(
      dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: false, strategy: 'raft' }),
    ).rejects.toThrow(/Raft voter w1 cannot change vote in term 1/);
  });
});

describe('raft.status (ADR-0184 Wave 2)', () => {
  it('auto-transitions to failed-quorum-not-reached on timeout (ADR-0131)', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'raft',
      proposalId: 'p1', timeoutMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await dispatch(fixture, { action: 'status', proposalId: 'p1' });
    const history = readState(fixture).consensus.history as ConsensusHistoryRow[];
    expect(history[0]?.result).toBe('failed-quorum-not-reached');
  });
});
