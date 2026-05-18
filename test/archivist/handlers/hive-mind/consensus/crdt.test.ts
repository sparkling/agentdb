// charter: dispatch
// ADR-0184 Wave 5 — crdt strategy behavioural tests + sampled-property tests
// for the CvRDT correctness triad (idempotency, commutativity, associativity)
// over `mergeCRDTState`.
//
// Per Wave 5 DA Block resolution (Concern 5): the property tests compare
// merge results via SEMANTIC ACCESSORS (`.elements().sort()` for ORSet,
// `.value()` for GCounter and LWWRegister), NOT raw `toJSON()` deep-equal.
// `ORSet.merge` produces internally-different array orderings depending on
// argument order — raw deep-equal on the JSON state fails for commutativity
// even though the semantic-equality (`.elements()`) holds.

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
import {
  GCounter,
  LWWRegister,
  ORSet,
  emptyCRDTState,
  mergeCRDTState,
  type CRDTState,
} from '../../../../../src/archivist/handlers/hive-mind/consensus/_crdt-types.js';

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

// ── Behavioural tests ──────────────────────────────────────────────────

describe('crdt.propose (ADR-0184 Wave 5)', () => {
  it('mints a pending proposal with empty CRDT triple and CRDT-specific fields', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'crdt', proposalId: 'p1',
    });
    const proposal = (readState(fixture).consensus.pending as ConsensusProposal[])[0]!;
    expect(proposal.strategy).toBe('crdt');
    expect(proposal.crdtState).toEqual(emptyCRDTState());
    expect(proposal.crdtExpectedVoters).toBe(3);
    expect(proposal.roundTimeoutMs).toBe(5000); // GOSSIP_ROUND_TIMEOUT_MS_DEFAULT
    expect(proposal.roundStartedAt).toBeDefined();
    // Non-CRDT fields explicit undefined per Axis (h).
    expect(proposal.timeoutAt).toBeUndefined();
    expect(proposal.byzantineVoters).toBeUndefined();
    expect(proposal.term).toBeUndefined();
    expect(proposal.gossipRound).toBeUndefined();
    expect(proposal.gossipExhausted).toBeUndefined();
  });
});

describe('crdt.vote (ADR-0184 Wave 5)', () => {
  it('synthesizes minimal snapshot on implicit-boolean yes-vote and merges into accumulator', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'crdt', proposalId: 'p1',
    });
    await dispatch(fixture, {
      action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'crdt',
    });
    const proposal = (readState(fixture).consensus.pending as ConsensusProposal[])[0]!;
    expect(proposal.crdtState).toBeDefined();
    const approverIds = ORSet.from<string>(proposal.crdtState!.approvers).elements();
    expect(approverIds).toContain('w1');
    expect(GCounter.from(proposal.crdtState!.votes).value()).toBe(1);
    expect(LWWRegister.from(proposal.crdtState!.verdict).value()).toBe('v');
  });

  it('accepts explicit crdtSnapshot triple and merges it verbatim', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'crdt', proposalId: 'p1',
    });
    // Build a hand-crafted snapshot for w1.
    const g = new GCounter();
    g.increment('w1');
    const aps = new ORSet<string>();
    aps.add('w1', 'w1');
    const reg = new LWWRegister<unknown>();
    reg.write('custom-value', 'w1', Date.now());
    const customSnapshot: CRDTState = {
      votes: g.toJSON(),
      approvers: aps.toJSON(),
      verdict: reg.toJSON(),
    };
    await dispatch(fixture, {
      action: 'vote', proposalId: 'p1', voterId: 'w1',
      crdtSnapshot: customSnapshot, strategy: 'crdt',
    });
    const proposal = (readState(fixture).consensus.pending as ConsensusProposal[])[0]!;
    expect(LWWRegister.from(proposal.crdtState!.verdict).value()).toBe('custom-value');
  });

  it('settles approved when distinctVoters >= crdtExpectedVoters and approverCount * 2 >= totalCast', async () => {
    // N=1 → crdtExpectedVoters=1. One yes-vote: distinctVoters=1 >= 1 → settle.
    // approverCount=1, totalCast=1, 1*2 >= 1 → approved.
    const fixture = makeFixture(freshState(['w1']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'crdt', proposalId: 'p1',
    });
    await dispatch(fixture, {
      action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'crdt',
    });
    const state = readState(fixture);
    expect(state.consensus.pending).toHaveLength(0);
    const history = state.consensus.history as ConsensusHistoryRow[];
    expect(history[0]?.result).toBe('approved');
    expect(history[0]?.strategy).toBe('crdt');
    // term + byzantineDetected: undefined for crdt.
    expect(history[0]?.term).toBeUndefined();
    expect(history[0]?.byzantineDetected).toBeUndefined();
  });

  it('rejects when no approvers (single no-vote at N=1)', async () => {
    const fixture = makeFixture(freshState(['w1']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'crdt', proposalId: 'p1',
    });
    await dispatch(fixture, {
      action: 'vote', proposalId: 'p1', voterId: 'w1', vote: false, strategy: 'crdt',
    });
    const history = readState(fixture).consensus.history as ConsensusHistoryRow[];
    expect(history[0]?.result).toBe('rejected');
  });

  it('throws on invalid crdtSnapshot shape (missing approvers key)', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'crdt', proposalId: 'p1',
    });
    const malformed = { votes: {}, verdict: {} }; // missing 'approvers'
    await expect(
      dispatch(fixture, {
        action: 'vote', proposalId: 'p1', voterId: 'w1',
        crdtSnapshot: malformed, strategy: 'crdt',
      }),
    ).rejects.toThrow(/crdtSnapshot must contain \{ votes, approvers, verdict \}/);
  });

  it('accepts same-voter re-submission per ADR-0121 row 12 (CRDT deviation from bft/raft/quorum/weighted)', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3', 'w4']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'crdt', proposalId: 'p1',
    });
    // First vote: w1 yes.
    await dispatch(fixture, {
      action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'crdt',
    });
    // Same voter re-submits — must NOT throw (CRDT permits, LWW handles).
    await expect(
      dispatch(fixture, {
        action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'crdt',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('crdt.status (ADR-0184 Wave 5)', () => {
  it('force-settles on timeout (roundTimeoutMs elapsed and not yet all voters submitted)', async () => {
    const fixture = makeFixture(freshState(['w1', 'w2', 'w3', 'w4']));
    await dispatch(fixture, {
      action: 'propose', type: 't', value: 'v', strategy: 'crdt',
      proposalId: 'p1', roundTimeoutMs: 1,
    });
    // Only one voter submits; need 4 for all-submitted settle.
    await dispatch(fixture, {
      action: 'vote', proposalId: 'p1', voterId: 'w1', vote: true, strategy: 'crdt',
    });
    // Wait past roundTimeoutMs.
    await new Promise((resolve) => setTimeout(resolve, 5));
    // Status fires force-settle on timeout.
    await dispatch(fixture, { action: 'status', proposalId: 'p1' });
    const state = readState(fixture);
    expect(state.consensus.pending).toHaveLength(0);
    const history = state.consensus.history as ConsensusHistoryRow[];
    expect(history[0]?.strategy).toBe('crdt');
    expect(['approved', 'rejected']).toContain(history[0]?.result);
  });
});

// ── Sampled-property tests (Wave 5 DA Concern 5 / Block resolution) ────

/**
 * Compare two CRDTStates via SEMANTIC ACCESSORS — NOT raw `toJSON()`
 * deep-equal. Per Wave 5 DA Block resolution:
 *   - ORSet: `.elements().sort()` — internal array orderings differ between
 *     `merge(a, b)` and `merge(b, a)` even though elements are equal.
 *   - GCounter: `.value()` (sum across slots) — but also need slot-wise equality
 *     to catch counter-bias bugs, which `.value()` would mask. So we compare
 *     both `.value()` AND the slot map (after re-shaping via toJSON, which is
 *     deterministic for GCounter).
 *   - LWWRegister: `.value()` — the winning value after lexicographic max.
 */
function crdtSemanticEqual(a: CRDTState, b: CRDTState): boolean {
  // GCounter: slot map IS deterministic (slot-wise max, no array ordering).
  // toJSON() gives `{ counts: {voterA: 3, voterB: 1} }` — direct equality works.
  const aCounts = GCounter.from(a.votes).toJSON().counts;
  const bCounts = GCounter.from(b.votes).toJSON().counts;
  if (Object.keys(aCounts).length !== Object.keys(bCounts).length) return false;
  for (const k of Object.keys(aCounts)) {
    if (aCounts[k] !== bCounts[k]) return false;
  }
  // ORSet: compare sorted elements (canonical form, ignores internal entry ordering).
  const aElements = ORSet.from<string>(a.approvers).elements().sort();
  const bElements = ORSet.from<string>(b.approvers).elements().sort();
  if (aElements.length !== bElements.length) return false;
  for (let i = 0; i < aElements.length; i++) {
    if (aElements[i] !== bElements[i]) return false;
  }
  // LWWRegister: compare the winning value (post-lexicographic-max).
  const aValue = LWWRegister.from(a.verdict).value();
  const bValue = LWWRegister.from(b.verdict).value();
  return aValue === bValue;
}

/** Build a random CRDTState for property-test sampling. Seeded deterministically
 *  per ADR-0184 Wave 5 DA Concern 5 (FNV-1a + mulberry32-style mixing). */
function buildRandomCRDTState(seedStr: string, voterPool: string[], valuePool: unknown[]): CRDTState {
  // FNV-1a seed.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619) >>> 0;
  }
  // Mulberry32-style stepper.
  const next = (): number => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h;
  };
  const g = new GCounter();
  for (const voter of voterPool) {
    const count = next() % 5;
    for (let i = 0; i < count; i++) g.increment(voter);
  }
  const aps = new ORSet<string>();
  for (const voter of voterPool) {
    if (next() % 2 === 0) aps.add(voter, voter);
  }
  const reg = new LWWRegister<unknown>();
  if (valuePool.length > 0) {
    const valueIdx = next() % valuePool.length;
    const voterIdx = next() % voterPool.length;
    const timestamp = (next() % 1_000_000) + 1; // positive non-zero
    reg.write(valuePool[valueIdx], voterPool[voterIdx]!, timestamp);
  }
  return {
    votes: g.toJSON(),
    approvers: aps.toJSON(),
    verdict: reg.toJSON(),
  };
}

describe('mergeCRDTState CvRDT properties (ADR-0184 Wave 5 sampled-property tests, 50 samples each)', () => {
  const voterPool = ['alice', 'bob', 'carol', 'dave'];
  const valuePool = ['accept', 'reject', 'abstain', 42, true, null];

  it('idempotent: crdtSemanticEqual(merge(x, x), x) for all sampled x', () => {
    for (let i = 0; i < 50; i++) {
      const x = buildRandomCRDTState(`idemp-${i}`, voterPool, valuePool);
      const merged = mergeCRDTState(x, x);
      expect(crdtSemanticEqual(merged, x)).toBe(true);
    }
  });

  it('commutative: crdtSemanticEqual(merge(a, b), merge(b, a)) for all sampled (a, b)', () => {
    for (let i = 0; i < 50; i++) {
      const a = buildRandomCRDTState(`comm-a-${i}`, voterPool, valuePool);
      const b = buildRandomCRDTState(`comm-b-${i}`, voterPool, valuePool);
      const ab = mergeCRDTState(a, b);
      const ba = mergeCRDTState(b, a);
      expect(crdtSemanticEqual(ab, ba)).toBe(true);
    }
  });

  it('associative: crdtSemanticEqual(merge(merge(a, b), c), merge(a, merge(b, c))) for all sampled (a, b, c)', () => {
    for (let i = 0; i < 50; i++) {
      const a = buildRandomCRDTState(`assoc-a-${i}`, voterPool, valuePool);
      const b = buildRandomCRDTState(`assoc-b-${i}`, voterPool, valuePool);
      const c = buildRandomCRDTState(`assoc-c-${i}`, voterPool, valuePool);
      const left = mergeCRDTState(mergeCRDTState(a, b), c);
      const right = mergeCRDTState(a, mergeCRDTState(b, c));
      expect(crdtSemanticEqual(left, right)).toBe(true);
    }
  });
});
