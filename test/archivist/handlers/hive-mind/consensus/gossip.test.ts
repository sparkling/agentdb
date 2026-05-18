// charter: dispatch
// ADR-0184 Wave 4 — gossip strategy behavioural tests (ADR-0120, push-style
// epidemic propagation with O(log N) convergence bound + hard-budget
// exhaustion handling).
//
// Cli-verbatim semantics caveat: N=1 gossip is degenerate per cli line 868-870
// — `bound=0` and the round-advance at step (4) push `gossipRound` to 1 BEFORE
// `settleCheckGossip` runs, and the hard-budget check (`gossipRound > 2*bound
// = 0`) fires first → N=1 proposals always exhaust on the first vote. Tests
// reflect this verbatim behaviour.
//
// Test-time-knob caveat: gossip tests use `roundTimeoutMs: 1` + a real-time
// `await new Promise(setTimeout, 5)` to nudge the wall clock past the timeout.
// The 5ms margin has been sufficient across Waves 2-3 timing tests. If a
// future CI environment flakes, the fix is either to widen the await margin
// or mock `Date.now()` — both are acceptable and documented per
// ADR-0184 Wave 4 DA Concern 6.

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

function freshState(workerIds: string[] = ['w1', 'w2']): HiveStateDoc {
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

describe('gossip.propose (ADR-0184 Wave 4)', () => {
  it('mints a pending proposal with gossip-specific fields and undefined threshold fields', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'gossip',
      roundTimeoutMs: 5000, proposalId: 'p1',
    });
    const proposal = (readState(fixture).consensus.pending as ConsensusProposal[])[0]!;
    expect(proposal.strategy).toBe('gossip');
    // Gossip-specific fields.
    expect(proposal.gossipRound).toBe(0);
    expect(proposal.lastVoteChangedRound).toBe(0);
    expect(proposal.totalNodes).toBe(3); // snapshot
    expect(proposal.currentRoundBroadcastSet).toEqual([]);
    expect(proposal.roundTimeoutMs).toBe(5000);
    expect(proposal.roundStartedAt).toBeDefined();
    // Threshold/byzantine/crdt fields undefined.
    expect(proposal.timeoutAt).toBeUndefined();
    expect(proposal.term).toBeUndefined();
    expect(proposal.byzantineVoters).toBeUndefined();
    expect(proposal.quorumPreset).toBeUndefined();
    expect(proposal.crdtState).toBeUndefined();
    expect(proposal.gossipExhausted).toBeUndefined();
  });

  it('applies GOSSIP_ROUND_TIMEOUT_MS_DEFAULT (5000) when caller omits roundTimeoutMs', async () => {
    const fixture = makeFixture(freshState());
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'gossip', proposalId: 'p1',
    });
    const proposal = (readState(fixture).consensus.pending as ConsensusProposal[])[0]!;
    expect(proposal.roundTimeoutMs).toBe(5000);
  });
});

describe('gossip.vote (ADR-0184 Wave 4) — N=2 settle on first majority-tilting vote', () => {
  it('settles approved when N=2, bound=1: single yes-vote covers all voters AND quiesces', async () => {
    // N=2, bound=gossipFanout(2)=ceil(log2(2))=1.
    // w1 votes yes: tally changes → lastVoteChangedRound=0; broadcastSet={w1};
    // selectGossipTargets picks 1 target from {w2}: {w1,w2}; coversAll →
    // gossipRound=1, lastVoteChangedRound stays at 0 (because round advanced
    // AFTER the lastVoteChanged update). settleCheckGossip: gossipRound(1) >=
    // bound(1) AND (gossipRound(1) > lastVoteChangedRound(0)) → settled.
    // votesFor(1) > votesAgainst(0) → approved.
    const fixture = makeFixture(freshState(['w1', 'w2']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'gossip', proposalId: 'p1',
    });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'gossip' });
    const state = readState(fixture);
    expect(state.consensus.pending).toHaveLength(0);
    const history = state.consensus.history as ConsensusHistoryRow[];
    expect(history[0]?.result).toBe('approved');
    expect(history[0]?.strategy).toBe('gossip');
    // term + byzantineDetected explicitly omitted for gossip per Wave 4 DA Axis (e).
    expect(history[0]?.term).toBeUndefined();
    expect(history[0]?.byzantineDetected).toBeUndefined();
  });

  it('settles rejected on first no-vote (votesAgainst > votesFor)', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'gossip', proposalId: 'p1',
    });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: false, strategy: 'gossip' });
    const history = readState(fixture).consensus.history as ConsensusHistoryRow[];
    expect(history[0]?.result).toBe('rejected');
  });
});

describe('gossip.vote (ADR-0184 Wave 4) — N>1 multi-worker propagation', () => {
  it('records vote with broadcast-set bookkeeping but stays pending when bound > 1 (more rounds needed)', async () => {
    // N=4, bound=ceil(log2(4))=2. First vote at round 0:
    // broadcastSet={w1, target1, target2} from fanout=2; if covers all, round→1.
    // settleCheckGossip at round 1, bound 2 → 1 < 2 → not settled.
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3', 'w4']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'gossip', proposalId: 'p1',
    });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'gossip' });
    const pending = readState(fixture).consensus.pending as ConsensusProposal[];
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe('pending');
    expect(pending[0]?.lastVoteChangedRound).toBe(0); // tally changed at round 0
  });

  it('throws ProposalAlreadyFailedError when voting on a historical proposal', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'gossip', proposalId: 'p1',
    });
    // N=2 first yes-vote settles + moves to history.
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'gossip' });
    // Second vote against historical → throws.
    await expect(
      dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w2', vote: true, strategy: 'gossip' }),
    ).rejects.toThrow(/proposal p1 is terminal/);
  });

  it('throws WorkerAlreadyFailedError when voter is marked absent', async () => {
    const state = freshState(['w1', 'w2']);
    state.workerMeta = { w1: { failedAt: Date.now(), retryOf: null } };
    const fixture = makeFixture(state);
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'gossip', proposalId: 'p1',
    });
    await expect(
      dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'gossip' }),
    ).rejects.toThrow(/already marked failed/);
  });
});

describe('gossip hard-budget exhaustion (ADR-0184 Wave 4 DA Concern 2)', () => {
  it('marks gossipExhausted=true when N=1 first-vote round-advance trips hard-budget (cli-verbatim degenerate)', async () => {
    // N=1: bound=0, exhaustion threshold = 2*bound = 0. Round-advance at
    // step (4) pushes gossipRound from 0 to 1. settleCheckGossip: hasVotes=true,
    // gossipRound(1) > 0 → exhausted. Per Wave 4 DA Concern 2: proposal stays
    // 'pending' with gossipExhausted=true.
    const fixture = makeFixture(freshState(['w1']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'gossip', proposalId: 'p1',
    });
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'gossip' });
    const proposal = (readState(fixture).consensus.pending as ConsensusProposal[])[0]!;
    expect(proposal.status).toBe('pending');
    expect(proposal.gossipExhausted).toBe(true);
    expect(readState(fixture).consensus.history).toHaveLength(0);
  });
});

describe('gossip.status (ADR-0184 Wave 4)', () => {
  it('persists round-advance on roundTimeoutMs elapsed (status path captures `advanced` flag)', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3', 'w4'])); // bound=2
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'gossip',
      proposalId: 'p1', roundTimeoutMs: 1,
    });
    // Cast a vote at round 0 — doesn't settle (covers-all check could fire,
    // but settleCheckGossip at gossipRound=1 vs bound=2 → 1<2 → not settled).
    await dispatch(fixture, { action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'gossip' });
    const proposalAfterVote = (readState(fixture).consensus.pending as ConsensusProposal[])[0]!;
    const roundBefore = proposalAfterVote.gossipRound ?? 0;
    // Wait past roundTimeoutMs.
    await new Promise((resolve) => setTimeout(resolve, 5));
    // Status fires maybeAdvanceGossipRoundOnTimeout → round advances.
    await dispatch(fixture, { action: 'status', proposalId: 'p1' });
    const proposalAfterStatus = (readState(fixture).consensus.pending as ConsensusProposal[])[0]!;
    // Round must have advanced via timeout-driven advance.
    expect(proposalAfterStatus.gossipRound).toBeGreaterThan(roundBefore);
  });
});
