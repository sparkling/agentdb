// charter: dispatch
// ADR-0184 Wave 2 — quorum strategy behavioural tests.

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

describe('quorum.propose (ADR-0184 Wave 2)', () => {
  it('defaults quorumPreset to majority', async () => {
    const fixture = makeFixture(freshState());
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'quorum', proposalId: 'p1',
    });
    const proposal = (readState(fixture).consensus.pending as ConsensusProposal[])[0]!;
    expect(proposal.strategy).toBe('quorum');
    expect(proposal.quorumPreset).toBe('majority');
    expect(proposal.byzantineVoters).toBeUndefined();
    expect(proposal.term).toBeUndefined();
  });

  it('honours quorumPreset: unanimous', async () => {
    const fixture = makeFixture(freshState());
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'quorum',
      quorumPreset: 'unanimous', proposalId: 'p1',
    });
    const proposal = (readState(fixture).consensus.pending as ConsensusProposal[])[0]!;
    expect(proposal.quorumPreset).toBe('unanimous');
  });
});

describe('quorum.vote (ADR-0184 Wave 2)', () => {
  it('approves on majority preset when floor(N/2)+1 yes votes reached', async () => {
    // floor(3/2)+1 = 2 yes votes.
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'quorum',
      proposalId: 'p1', quorumPreset: 'majority',
    });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'quorum' });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w2', vote: true, strategy: 'quorum' });
    const state = readState(fixture);
    expect(state.consensus.pending).toHaveLength(0);
    expect((state.consensus.history as ConsensusHistoryRow[])[0]?.result).toBe('approved');
  });

  it('fast-rejects on unanimous preset when any against-vote arrives', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'quorum',
      proposalId: 'p1', quorumPreset: 'unanimous',
    });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'quorum' });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w2', vote: false, strategy: 'quorum' });
    const state = readState(fixture);
    expect(state.consensus.pending).toHaveLength(0);
    expect((state.consensus.history as ConsensusHistoryRow[])[0]?.result).toBe('rejected');
  });

  it('throws DuplicateVoteError on any second vote from the same voter', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'quorum', proposalId: 'p1',
    });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'quorum' });
    await expect(
      dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'quorum' }),
    ).rejects.toThrow(/already cast the same vote/);
  });
});

describe('quorum.status (ADR-0184 Wave 2)', () => {
  it('auto-transitions to failed-quorum-not-reached on timeout (ADR-0131)', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'quorum',
      proposalId: 'p1', timeoutMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await dispatch(fixture, { action: 'status', proposalId: 'p1' });
    const history = readState(fixture).consensus.history as ConsensusHistoryRow[];
    expect(history[0]?.result).toBe('failed-quorum-not-reached');
  });
});
