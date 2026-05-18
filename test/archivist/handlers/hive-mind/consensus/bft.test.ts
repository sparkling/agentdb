// charter: dispatch
// ADR-0184 Wave 2 — bft strategy behavioural tests. Exercises propose / vote
// / status / list against the parent dispatcher (so the test path matches the
// production path through `consensusHiveMindHandler`).

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

describe('bft.propose (ADR-0184 Wave 2)', () => {
  it('mints a pending proposal with byzantineVoters:[] and threshold-based timeoutAt', async () => {
    const fixture = makeFixture(freshState());
    await dispatch(fixture, {
      action: 'propose',
      type: 'test',
      value: 'hello',
      strategy: 'bft',
      timeoutMs: 60_000,
      voterId: 'queen',
    });
    const state = readState(fixture);
    const pending = state.consensus.pending as ConsensusProposal[];
    expect(pending).toHaveLength(1);
    const proposal = pending[0]!;
    expect(proposal.strategy).toBe('bft');
    expect(proposal.byzantineVoters).toEqual([]);
    expect(proposal.timeoutAt).toBeDefined();
    expect(proposal.proposedBy).toBe('queen');
    expect(proposal.type).toBe('test');
    expect(proposal.value).toBe('hello');
    // Non-bft fields explicitly undefined per Wave 2 DA Axis (h).
    expect(proposal.quorumPreset).toBeUndefined();
    expect(proposal.gossipRound).toBeUndefined();
    expect(proposal.crdtState).toBeUndefined();
  });

  it('honours caller-supplied proposalId verbatim (Wave 2 DA Concern 3)', async () => {
    const fixture = makeFixture(freshState());
    await dispatch(fixture, {
      action: 'propose',
      type: 'test',
      value: 'x',
      strategy: 'bft',
      proposalId: 'proposal-pre-minted-abc',
    });
    const state = readState(fixture);
    const proposalIds = (state.consensus.pending as ConsensusProposal[]).map((p) => p.proposalId);
    expect(proposalIds).toEqual(['proposal-pre-minted-abc']);
  });
});

describe('bft.vote (ADR-0184 Wave 2)', () => {
  it('records vote and resolves to approved when threshold (f+1 of 2f+1 = 3 for N=3) reached', async () => {
    // floor(2*3/3) + 1 = 3 — needs all 3 yes votes to approve at N=3.
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3']));
    await dispatch(fixture, {
      action: 'propose',
      type: 't',
      value: 'v',
      strategy: 'bft',
      proposalId: 'p1',
    });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'bft' });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w2', vote: true, strategy: 'bft' });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w3', vote: true, strategy: 'bft' });
    const state = readState(fixture);
    expect(state.consensus.pending).toHaveLength(0);
    const history = state.consensus.history as ConsensusHistoryRow[];
    expect(history).toHaveLength(1);
    expect(history[0]?.result).toBe('approved');
    expect(history[0]?.strategy).toBe('bft');
    expect(history[0]?.votes).toEqual({ for: 3, against: 0 });
  });

  it('marks same-voter conflicting vote as byzantine and drops the conflicting vote', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3']));
    await dispatch(fixture, { action: 'propose', type: 't', value: 'v', strategy: 'bft', proposalId: 'p1' });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'bft' });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: false, strategy: 'bft' });
    const state = readState(fixture);
    const proposal = (state.consensus.pending as ConsensusProposal[])[0]!;
    expect(proposal.byzantineVoters).toContain('w1');
    expect(proposal.votes['w1']).toBeUndefined();
  });

  it('detects cross-proposal Byzantine behaviour (same type, conflicting vote across proposals)', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3', 'w4']));
    await dispatch(fixture, { action: 'propose', type: 'sameType', value: 'a', strategy: 'bft', proposalId: 'pA' });
    await dispatch(fixture, { action: 'propose', type: 'sameType', value: 'b', strategy: 'bft', proposalId: 'pB' });
    await dispatch(fixture, { action: 'vote', proposalId: 'pA', voterId: 'w1', vote: true, strategy: 'bft' });
    await dispatch(fixture, { action: 'vote', proposalId: 'pB', voterId: 'w1', vote: false, strategy: 'bft' });
    const state = readState(fixture);
    const pB = (state.consensus.pending as ConsensusProposal[]).find((p) => p.proposalId === 'pB')!;
    expect(pB.byzantineVoters).toContain('w1');
    // Vote was REJECTED — not recorded in pB.votes.
    expect(pB.votes['w1']).toBeUndefined();
  });

  it('throws ProposalAlreadyFailedError when voting on a historical proposal', async () => {
    const fixture = makeFixture(freshState(['w1']));
    await dispatch(fixture, { action: 'propose', type: 't', value: 'v', strategy: 'bft', proposalId: 'p1' });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'bft' });
    // floor(2*1/3) + 1 = 1 → resolves on first yes; p1 moves to history.
    await expect(
      dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'bft' }),
    ).rejects.toThrow(/proposal p1 is terminal/);
  });

  it('throws WorkerAlreadyFailedError when voter is marked absent', async () => {
    const state = freshState(['w1']);
    state.workerMeta = { w1: { failedAt: Date.now(), retryOf: null } };
    const fixture = makeFixture(state);
    await dispatch(fixture, { action: 'propose', type: 't', value: 'v', strategy: 'bft', proposalId: 'p1' });
    await expect(
      dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'bft' }),
    ).rejects.toThrow(/already marked failed/);
  });
});

describe('bft.status (ADR-0184 Wave 2)', () => {
  it('auto-transitions to failed-quorum-not-reached when timeoutAt elapsed and votes < required', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3']));
    await dispatch(fixture, {
      action: 'propose',
      type: 't',
      value: 'v',
      strategy: 'bft',
      proposalId: 'p1',
      timeoutMs: 1, // immediately elapsed
    });
    // Wait 5ms to ensure Date.now() > timeoutAt.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await dispatch(fixture, { action: 'status', proposalId: 'p1' });
    const state = readState(fixture);
    expect(state.consensus.pending).toHaveLength(0);
    const history = state.consensus.history as ConsensusHistoryRow[];
    expect(history).toHaveLength(1);
    expect(history[0]?.result).toBe('failed-quorum-not-reached');
    expect(history[0]?.absentVoters).toEqual(['w1', 'w2', 'w3']);
  });
});
