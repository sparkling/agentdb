// charter: dispatch
// ADR-0184 Wave 3 — weighted strategy behavioural tests (ADR-0119, queen 3x).

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

/** Build a hive state with optional queen + workers. The queen counts as one
 *  worker entry (its agentId is in `state.workers`) per the cli's
 *  `totalNodes = state.workers.length` accounting. */
function freshState(opts: { queen?: { agentId: string }; workers?: string[] } = {}): HiveStateDoc {
  const workers = opts.workers ?? ['queen-1', 'w1', 'w2']; // queen + 2 workers
  const doc: HiveStateDoc = {
    initialized: true,
    workers,
    workerMeta: {},
    consensus: { pending: [], history: [] },
    sharedMemory: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (opts.queen) {
    (doc as { queen?: { agentId: string } }).queen = opts.queen;
  }
  return doc;
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

describe('weighted.propose (ADR-0184 Wave 3)', () => {
  it('mints a pending proposal when state.queen is present', async () => {
    const fixture = makeFixture(freshState({ queen: { agentId: 'queen-1' } }));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'weighted', proposalId: 'p1',
    });
    const proposal = (readState(fixture).consensus.pending as ConsensusProposal[])[0]!;
    expect(proposal.strategy).toBe('weighted');
    expect(proposal.timeoutAt).toBeDefined();
    // Non-weighted fields explicitly undefined per Axis (h).
    expect(proposal.byzantineVoters).toBeUndefined();
    expect(proposal.term).toBeUndefined();
    expect(proposal.quorumPreset).toBeUndefined();
  });

  it('throws MissingQueenForWeightedConsensusError when state.queen is undefined at propose', async () => {
    const fixture = makeFixture(freshState({ queen: undefined }));
    await expect(
      dispatch(fixture, {
        action: 'propose', type: 't', value: 'v', strategy: 'weighted', proposalId: 'p1',
      }),
    ).rejects.toThrow(/weighted strategy requires an elected queen/);
  });
});

describe('weighted.vote (ADR-0184 Wave 3) — queen 3x voting power', () => {
  it('queen-only-yes approves the proposal at N=3 (workers=[queen,w1,w2], required=(3-1)+3=5; queen contributes 3, two workers must also vote yes)', async () => {
    const fixture = makeFixture(freshState({
      queen: { agentId: 'queen-1' },
      workers: ['queen-1', 'w1', 'w2'],
    }));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'weighted', proposalId: 'p1',
    });
    // Queen yes alone = 3 weight; required = 5; not enough.
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'queen-1', vote: true, strategy: 'weighted' });
    expect(readState(fixture).consensus.pending).toHaveLength(1);
    // Add worker yes → 3+1=4; still not 5.
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'weighted' });
    expect(readState(fixture).consensus.pending).toHaveLength(1);
    // Add second worker yes → 3+1+1=5; approves.
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w2', vote: true, strategy: 'weighted' });
    const state = readState(fixture);
    expect(state.consensus.pending).toHaveLength(0);
    const history = state.consensus.history as ConsensusHistoryRow[];
    expect(history[0]?.result).toBe('approved');
    expect(history[0]?.votes.for).toBe(5); // weighted sum: 3 (queen) + 1 + 1
  });

  it('weighted deadlock arithmetic rejects when neither side can reach the weighted threshold', async () => {
    const fixture = makeFixture(freshState({
      queen: { agentId: 'queen-1' },
      workers: ['queen-1', 'w1', 'w2'],
    }));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'weighted', proposalId: 'p1',
    });
    // queen yes (3) + w1 no (1): for=3 against=1, workerSlotsRemaining=1,
    // queen cast → weightedRemaining=1. votesFor(3)+1=4 < 5, votesAgainst(1)+1=2 < 5
    // → tryResolveProposal returns 'rejected' (deadlock — no side can reach 5).
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'queen-1', vote: true, strategy: 'weighted' });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: false, strategy: 'weighted' });
    const state = readState(fixture);
    expect(state.consensus.pending).toHaveLength(0);
    const history = state.consensus.history as ConsensusHistoryRow[];
    expect(history[0]?.result).toBe('rejected');
    // Tally telemetry on the history row reflects the weighted sums at resolution time.
    expect(history[0]?.votes.for).toBe(3); // queen weight
    expect(history[0]?.votes.against).toBe(1); // worker weight
  });

  it('throws MissingQueenForWeightedConsensusError when queen abdicated between propose and vote', async () => {
    // Propose with queen present.
    const stateWithQueen = freshState({
      queen: { agentId: 'queen-1' },
      workers: ['queen-1', 'w1', 'w2'],
    });
    const fixture = makeFixture(stateWithQueen);
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'weighted', proposalId: 'p1',
    });
    // Simulate abdication: remove queen from state in the fixture.
    const stored = fixture.files.get(STORE_ID) as { root: HiveStateDoc };
    delete (stored.root as { queen?: unknown }).queen;
    fixture.files.set(STORE_ID, stored);
    // Vote-time queen guard fires.
    await expect(
      dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'weighted' }),
    ).rejects.toThrow(/weighted strategy requires an elected queen/);
  });

  it('throws DuplicateVoteError on second vote from same voter', async () => {
    const fixture = makeFixture(freshState({
      queen: { agentId: 'queen-1' },
      workers: ['queen-1', 'w1', 'w2'],
    }));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'weighted', proposalId: 'p1',
    });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'weighted' });
    await expect(
      dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'weighted' }),
    ).rejects.toThrow(/already cast the same vote/);
  });
});

describe('weighted.status (ADR-0184 Wave 3)', () => {
  it('auto-transitions to failed-quorum-not-reached on timeout (ADR-0131)', async () => {
    const fixture = makeFixture(freshState({
      queen: { agentId: 'queen-1' },
      workers: ['queen-1', 'w1', 'w2'],
    }));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'weighted',
      proposalId: 'p1', timeoutMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await dispatch(fixture, { action: 'status', proposalId: 'p1' });
    const history = readState(fixture).consensus.history as ConsensusHistoryRow[];
    expect(history[0]?.result).toBe('failed-quorum-not-reached');
    expect(history[0]?.strategy).toBe('weighted');
  });

  it('throws MissingQueenForWeightedConsensusError when queen abdicated before status-time auto-transition (DA Concern 3 resolution)', async () => {
    const fixture = makeFixture(freshState({
      queen: { agentId: 'queen-1' },
      workers: ['queen-1', 'w1', 'w2'],
    }));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'weighted',
      proposalId: 'p1', timeoutMs: 1,
    });
    // Abdicate before status fires.
    const stored = fixture.files.get(STORE_ID) as { root: HiveStateDoc };
    delete (stored.root as { queen?: unknown }).queen;
    fixture.files.set(STORE_ID, stored);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(
      dispatch(fixture, { action: 'status', proposalId: 'p1' }),
    ).rejects.toThrow(/weighted strategy requires an elected queen/);
  });
});
