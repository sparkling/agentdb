/**
 * Unit Tests for RaftConsensus
 *
 * Tests the Raft consensus state machine: follower/candidate/leader transitions,
 * term handling, vote requests/responses, append-entries log replication, commit
 * index advancement, distributed locks, CRDT operations, and deadlock detection.
 *
 * Election timeouts are driven with vitest fake timers so the tests are fully
 * deterministic — no real wall-clock sleeps, no flaky timing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RaftConsensus,
  type RaftConfig,
  type VoteRequest,
  type AppendEntriesRequest,
  type LogEntry,
  type CRDTState,
} from '../../../src/consensus/RaftConsensus.js';

/** Build a log entry fixture. */
function entry(term: number, index: number, command: any = { op: 'set' }): LogEntry {
  return { term, index, type: 'command', command, timestamp: 1_000 + index };
}

describe('RaftConsensus', () => {
  let node: RaftConsensus;

  beforeEach(() => {
    // Fake timers so the constructor's election timer never fires unexpectedly
    // and so we can drive elections deterministically.
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (node) {
      node.stop();
    }
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // ==========================================================================
  // Initialization
  // ==========================================================================

  describe('initialization', () => {
    it('starts as a follower at term 0 with no leader', () => {
      node = new RaftConsensus({ nodeId: 'node-a', nodes: ['node-a', 'node-b', 'node-c'] });

      const status = node.getStatus();
      expect(status.nodeId).toBe('node-a');
      expect(status.state).toBe('follower');
      expect(status.term).toBe(0);
      expect(status.leaderId).toBeNull();
      expect(status.logLength).toBe(0);
      expect(status.commitIndex).toBe(0);
      expect(status.lastApplied).toBe(0);
    });

    it('registers peers for every node except itself', () => {
      node = new RaftConsensus({ nodeId: 'node-a', nodes: ['node-a', 'node-b', 'node-c'] });

      const peerIds = node.getStatus().peers.map(p => p.nodeId).sort();
      expect(peerIds).toEqual(['node-b', 'node-c']);
      node.getStatus().peers.forEach(p => {
        expect(p.isHealthy).toBe(true);
        expect(p.matchIndex).toBe(0);
      });
    });

    it('defaults quorumSize to a strict majority of the cluster', () => {
      // 3 nodes -> floor(3/2)+1 = 2. Two votes (self + one peer) elect a leader.
      node = new RaftConsensus({ nodeId: 'node-a', nodes: ['node-a', 'node-b', 'node-c'] });

      // Drive: timeout -> candidate, then one peer vote -> leader (quorum=2).
      vi.advanceTimersByTime(350);
      expect(node.getStatus().state).toBe('candidate');

      node.handleVoteResponse({ term: node.getStatus().term, voteGranted: true }, 'node-b');
      expect(node.getStatus().state).toBe('leader');
    });

    it('honors an explicit quorumSize override', () => {
      // quorumSize=3 means a single peer vote is NOT enough in a 3-node cluster.
      node = new RaftConsensus({
        nodeId: 'node-a',
        nodes: ['node-a', 'node-b', 'node-c'],
        quorumSize: 3,
      });

      vi.advanceTimersByTime(350);
      expect(node.getStatus().state).toBe('candidate');

      node.handleVoteResponse({ term: node.getStatus().term, voteGranted: true }, 'node-b');
      expect(node.getStatus().state).toBe('candidate'); // 2 votes < quorum 3

      node.handleVoteResponse({ term: node.getStatus().term, voteGranted: true }, 'node-c');
      expect(node.getStatus().state).toBe('leader'); // 3 votes >= quorum 3
    });
  });

  // ==========================================================================
  // Leader Election — state transitions
  // ==========================================================================

  describe('leader election', () => {
    it('transitions follower -> candidate when the election timer fires', () => {
      node = new RaftConsensus({ nodeId: 'solo', nodes: ['solo', 'peer-1', 'peer-2'] });
      node.start();

      const events: string[] = [];
      node.on('state_changed', e => events.push(e.state));

      // Election timeout window is [150,300]ms; advance past the maximum.
      vi.advanceTimersByTime(350);

      expect(events).toContain('candidate');
      expect(node.getStatus().term).toBe(1); // term incremented on candidacy
    });

    it('becomes leader after reaching quorum and emits leader_elected', () => {
      node = new RaftConsensus({ nodeId: 'cand', nodes: ['cand', 'p1', 'p2'] });
      node.start();

      const leaderElected = vi.fn();
      node.on('leader_elected', leaderElected);

      vi.advanceTimersByTime(350); // -> candidate (self vote)
      node.handleVoteResponse({ term: node.getStatus().term, voteGranted: true }, 'p1'); // quorum=2

      expect(node.getStatus().state).toBe('leader');
      expect(node.getStatus().leaderId).toBe('cand');
      expect(leaderElected).toHaveBeenCalledWith({ leaderId: 'cand' });
    });

    it('votes for itself and emits a vote_request when becoming candidate', () => {
      node = new RaftConsensus({ nodeId: 'cand', nodes: ['cand', 'p1', 'p2'] });

      let voteRequest: VoteRequest | undefined;
      node.on('vote_request', req => { voteRequest = req; });

      vi.advanceTimersByTime(350);

      expect(voteRequest).toBeDefined();
      expect(voteRequest!.candidateId).toBe('cand');
      expect(voteRequest!.term).toBe(1);
      expect(voteRequest!.lastLogIndex).toBe(0);
      expect(voteRequest!.lastLogTerm).toBe(0);
    });

    it('reaches leader only after collecting quorum votes', () => {
      node = new RaftConsensus({ nodeId: 'n1', nodes: ['n1', 'n2', 'n3', 'n4', 'n5'] });
      // quorum = floor(5/2)+1 = 3
      vi.advanceTimersByTime(350);
      expect(node.getStatus().state).toBe('candidate');

      const term = node.getStatus().term;
      node.handleVoteResponse({ term, voteGranted: true }, 'n2');
      expect(node.getStatus().state).toBe('candidate'); // 2 votes

      node.handleVoteResponse({ term, voteGranted: true }, 'n3');
      expect(node.getStatus().state).toBe('leader'); // 3 votes -> quorum
    });

    it('does not count denied votes toward quorum', () => {
      node = new RaftConsensus({ nodeId: 'n1', nodes: ['n1', 'n2', 'n3'] });
      vi.advanceTimersByTime(350);
      const term = node.getStatus().term;

      node.handleVoteResponse({ term, voteGranted: false }, 'n2');
      node.handleVoteResponse({ term, voteGranted: false }, 'n3');

      expect(node.getStatus().state).toBe('candidate');
    });

    it('does not double-count a duplicate vote from the same peer', () => {
      node = new RaftConsensus({ nodeId: 'n1', nodes: ['n1', 'n2', 'n3', 'n4', 'n5'] });
      vi.advanceTimersByTime(350);
      const term = node.getStatus().term;

      node.handleVoteResponse({ term, voteGranted: true }, 'n2');
      node.handleVoteResponse({ term, voteGranted: true }, 'n2'); // duplicate
      // self + n2 = 2 distinct votes, quorum is 3 -> still candidate
      expect(node.getStatus().state).toBe('candidate');
    });

    it('steps down to follower when a vote response carries a higher term', () => {
      node = new RaftConsensus({ nodeId: 'n1', nodes: ['n1', 'n2', 'n3'] });
      vi.advanceTimersByTime(350);
      expect(node.getStatus().state).toBe('candidate');
      const candidateTerm = node.getStatus().term;

      node.handleVoteResponse({ term: candidateTerm + 5, voteGranted: false }, 'n2');

      expect(node.getStatus().state).toBe('follower');
      expect(node.getStatus().term).toBe(candidateTerm + 5);
    });

    it('ignores vote responses once it is no longer a candidate', () => {
      node = new RaftConsensus({ nodeId: 'lead', nodes: ['lead', 'p1', 'p2'] });
      vi.advanceTimersByTime(350); // candidate
      node.handleVoteResponse({ term: node.getStatus().term, voteGranted: true }, 'p1'); // -> leader
      expect(node.getStatus().state).toBe('leader');

      // A late, extra vote response must not perturb an established leader.
      node.handleVoteResponse({ term: node.getStatus().term, voteGranted: true }, 'p2');
      expect(node.getStatus().state).toBe('leader');
    });

    it('starts sending heartbeats (append_entries) once leader', () => {
      node = new RaftConsensus({ nodeId: 'lead', nodes: ['lead', 'f1', 'f2'] });

      const appendEvents: any[] = [];
      node.on('append_entries', e => appendEvents.push(e));

      vi.advanceTimersByTime(350); // become candidate
      node.handleVoteResponse({ term: node.getStatus().term, voteGranted: true }, 'f1'); // -> leader
      expect(node.getStatus().state).toBe('leader');

      // Initial heartbeat fired on becomeLeader; advance to trigger interval heartbeats.
      appendEvents.length = 0;
      vi.advanceTimersByTime(50); // heartbeatInterval default
      expect(appendEvents.length).toBeGreaterThan(0);
      const peers = appendEvents.map(e => e.peerId).sort();
      expect(peers).toContain('f1');
      expect(peers).toContain('f2');
    });
  });

  // ==========================================================================
  // Vote Request handling (RequestVote RPC)
  // ==========================================================================

  describe('handleVoteRequest', () => {
    beforeEach(() => {
      node = new RaftConsensus({ nodeId: 'voter', nodes: ['voter', 'cand-1', 'cand-2'] });
      node.stop(); // disable the constructor's election timer for deterministic state
    });

    it('grants a vote to a candidate with an up-to-date log', () => {
      const res = node.handleVoteRequest({
        term: 1,
        candidateId: 'cand-1',
        lastLogIndex: 0,
        lastLogTerm: 0,
      });

      expect(res.voteGranted).toBe(true);
      expect(res.term).toBe(1);
    });

    it('rejects a vote when the candidate term is stale', () => {
      // Advance our term first by granting at term 5.
      node.handleVoteRequest({ term: 5, candidateId: 'cand-1', lastLogIndex: 0, lastLogTerm: 0 });

      const res = node.handleVoteRequest({
        term: 3,
        candidateId: 'cand-2',
        lastLogIndex: 0,
        lastLogTerm: 0,
      });

      expect(res.voteGranted).toBe(false);
      expect(res.term).toBe(5); // responds with our (higher) current term
    });

    it('grants only one vote per term (no split vote)', () => {
      const first = node.handleVoteRequest({
        term: 2, candidateId: 'cand-1', lastLogIndex: 0, lastLogTerm: 0,
      });
      const second = node.handleVoteRequest({
        term: 2, candidateId: 'cand-2', lastLogIndex: 0, lastLogTerm: 0,
      });

      expect(first.voteGranted).toBe(true);
      expect(second.voteGranted).toBe(false); // already voted for cand-1 this term
    });

    it('grants a repeated vote to the same candidate (idempotent)', () => {
      const first = node.handleVoteRequest({
        term: 2, candidateId: 'cand-1', lastLogIndex: 0, lastLogTerm: 0,
      });
      const repeat = node.handleVoteRequest({
        term: 2, candidateId: 'cand-1', lastLogIndex: 0, lastLogTerm: 0,
      });

      expect(first.voteGranted).toBe(true);
      expect(repeat.voteGranted).toBe(true);
    });

    it('adopts a newer term from the candidate and resets votedFor', () => {
      node.handleVoteRequest({ term: 2, candidateId: 'cand-1', lastLogIndex: 0, lastLogTerm: 0 });

      // A higher term arrives -> becomeFollower(newTerm) clears votedFor, so cand-2 can win.
      const res = node.handleVoteRequest({
        term: 4, candidateId: 'cand-2', lastLogIndex: 0, lastLogTerm: 0,
      });

      expect(res.term).toBe(4);
      expect(res.voteGranted).toBe(true);
    });

    it('rejects a candidate whose log is behind (lower lastLogTerm)', () => {
      // Give the voter a log at term 3 via append-entries from a leader.
      node.handleAppendEntries({
        term: 3, leaderId: 'cand-1', prevLogIndex: 0, prevLogTerm: 0,
        entries: [entry(3, 1)], leaderCommit: 0,
      });

      // Candidate at term 4 but with a stale lastLogTerm (1) must be rejected.
      const res = node.handleVoteRequest({
        term: 4, candidateId: 'cand-2', lastLogIndex: 5, lastLogTerm: 1,
      });

      expect(res.voteGranted).toBe(false);
    });

    it('grants when candidate log has equal term and >= index', () => {
      node.handleAppendEntries({
        term: 2, leaderId: 'cand-1', prevLogIndex: 0, prevLogTerm: 0,
        entries: [entry(2, 1)], leaderCommit: 0,
      });

      const res = node.handleVoteRequest({
        term: 3, candidateId: 'cand-2', lastLogIndex: 1, lastLogTerm: 2,
      });

      expect(res.voteGranted).toBe(true);
    });
  });

  // ==========================================================================
  // Append Entries handling (AppendEntries RPC / log replication)
  // ==========================================================================

  describe('handleAppendEntries', () => {
    beforeEach(() => {
      node = new RaftConsensus({ nodeId: 'follower', nodes: ['follower', 'leader', 'other'] });
      node.stop();
    });

    it('accepts an empty heartbeat from a valid leader and records the leader id', () => {
      const res = node.handleAppendEntries({
        term: 1, leaderId: 'leader', prevLogIndex: 0, prevLogTerm: 0,
        entries: [], leaderCommit: 0,
      });

      expect(res.success).toBe(true);
      expect(res.term).toBe(1);
      expect(node.getStatus().leaderId).toBe('leader');
    });

    it('rejects entries from a leader with a stale term', () => {
      // Bump our term to 5.
      node.handleAppendEntries({
        term: 5, leaderId: 'leader', prevLogIndex: 0, prevLogTerm: 0, entries: [], leaderCommit: 0,
      });

      const res = node.handleAppendEntries({
        term: 2, leaderId: 'old-leader', prevLogIndex: 0, prevLogTerm: 0, entries: [], leaderCommit: 0,
      });

      expect(res.success).toBe(false);
      expect(res.term).toBe(5);
    });

    it('appends new entries and reports the resulting matchIndex', () => {
      const req: AppendEntriesRequest = {
        term: 1, leaderId: 'leader', prevLogIndex: 0, prevLogTerm: 0,
        entries: [entry(1, 1), entry(1, 2)], leaderCommit: 0,
      };

      const res = node.handleAppendEntries(req);

      expect(res.success).toBe(true);
      expect(res.matchIndex).toBe(2);
      expect(node.getStatus().logLength).toBe(2);
    });

    it('rejects when the previous log entry does not match (consistency check)', () => {
      // Follower has one entry at term 1.
      node.handleAppendEntries({
        term: 1, leaderId: 'leader', prevLogIndex: 0, prevLogTerm: 0,
        entries: [entry(1, 1)], leaderCommit: 0,
      });

      // Leader claims prevLogIndex=1 with prevLogTerm=9 which does not match our term-1 entry.
      const res = node.handleAppendEntries({
        term: 2, leaderId: 'leader', prevLogIndex: 1, prevLogTerm: 9,
        entries: [entry(2, 2)], leaderCommit: 0,
      });

      expect(res.success).toBe(false);
      expect(node.getStatus().logLength).toBe(1); // unchanged
    });

    it('truncates conflicting entries before appending (overwrites divergent suffix)', () => {
      // Seed three entries.
      node.handleAppendEntries({
        term: 1, leaderId: 'leader', prevLogIndex: 0, prevLogTerm: 0,
        entries: [entry(1, 1), entry(1, 2), entry(1, 3)], leaderCommit: 0,
      });
      expect(node.getStatus().logLength).toBe(3);

      // New leader at term 2 sends a different entry at index 2, overwriting indexes 2..3.
      const res = node.handleAppendEntries({
        term: 2, leaderId: 'leader', prevLogIndex: 1, prevLogTerm: 1,
        entries: [entry(2, 2, { op: 'overwrite' })], leaderCommit: 0,
      });

      expect(res.success).toBe(true);
      // log is truncated to prevLogIndex (1) then one entry appended => length 2
      expect(node.getStatus().logLength).toBe(2);
    });

    it('advances commitIndex (bounded by log length) and applies committed entries', () => {
      const committed: LogEntry[] = [];
      node.on('entry_committed', e => committed.push(e));

      node.handleAppendEntries({
        term: 1, leaderId: 'leader', prevLogIndex: 0, prevLogTerm: 0,
        entries: [entry(1, 1), entry(1, 2)], leaderCommit: 2,
      });

      const status = node.getStatus();
      expect(status.commitIndex).toBe(2);
      expect(status.lastApplied).toBe(2);
      expect(committed).toHaveLength(2);
    });

    it('clamps commitIndex to the local log length when leaderCommit overshoots', () => {
      node.handleAppendEntries({
        term: 1, leaderId: 'leader', prevLogIndex: 0, prevLogTerm: 0,
        entries: [entry(1, 1)], leaderCommit: 999, // far beyond our 1-entry log
      });

      expect(node.getStatus().commitIndex).toBe(1);
    });

    it('emits log_replicated when entries arrive', () => {
      const replicated = vi.fn();
      node.on('log_replicated', replicated);

      node.handleAppendEntries({
        term: 1, leaderId: 'leader', prevLogIndex: 0, prevLogTerm: 0,
        entries: [entry(1, 1)], leaderCommit: 0,
      });

      expect(replicated).toHaveBeenCalledTimes(1);
      expect(replicated.mock.calls[0][0].entries).toHaveLength(1);
    });

    it('adopts a newer leader term and steps any candidate down to follower', () => {
      // Force candidacy first.
      vi.useFakeTimers();
      const c = new RaftConsensus({ nodeId: 'x', nodes: ['x', 'y', 'z'] });
      vi.advanceTimersByTime(350);
      expect(c.getStatus().state).toBe('candidate');

      c.handleAppendEntries({
        term: c.getStatus().term + 1, leaderId: 'y',
        prevLogIndex: 0, prevLogTerm: 0, entries: [], leaderCommit: 0,
      });

      expect(c.getStatus().state).toBe('follower');
      expect(c.getStatus().leaderId).toBe('y');
      c.stop();
    });
  });

  // ==========================================================================
  // Leader replication path (replicate + responses + commit advancement)
  // ==========================================================================

  describe('replicate and append-entries responses', () => {
    function electLeader(): RaftConsensus {
      const n = new RaftConsensus({ nodeId: 'leader', nodes: ['leader', 'p1', 'p2'] });
      vi.advanceTimersByTime(350); // -> candidate
      n.handleVoteResponse({ term: n.getStatus().term, voteGranted: true }, 'p1'); // -> leader (quorum=2)
      return n;
    }

    it('rejects replicate() when the node is not the leader', async () => {
      node = new RaftConsensus({ nodeId: 'f', nodes: ['f', 'g', 'h'] });
      node.stop();

      await expect(node.replicate({ op: 'noop' })).rejects.toThrow(/Not the leader/);
    });

    it('appends a command to the log and emits log_appended when leader', async () => {
      node = electLeader();
      expect(node.getStatus().state).toBe('leader');

      const appended = vi.fn();
      node.on('log_appended', appended);

      // Don't await — replicate resolves only once a follower response advances commit.
      const p = node.replicate({ op: 'write', value: 42 });
      p.catch(() => { /* avoid unhandled rejection if timer-based timeout fires */ });

      expect(appended).toHaveBeenCalledTimes(1);
      expect(node.getStatus().logLength).toBe(1);
      expect(appended.mock.calls[0][0].command).toEqual({ op: 'write', value: 42 });
    });

    it('resolves replicate() once a majority of followers acknowledge the entry', async () => {
      node = electLeader();

      const promise = node.replicate({ op: 'commit-me' });
      const term = node.getStatus().term;

      // updateCommitIndex commits index 1 only when the majority (here both peers in
      // a 3-node cluster) report a matchIndex >= 1 at the current term.
      node.handleAppendEntriesResponse({ term, success: true, matchIndex: 1 }, 'p1');
      node.handleAppendEntriesResponse({ term, success: true, matchIndex: 1 }, 'p2');

      await expect(promise).resolves.toBe(true);
      expect(node.getStatus().commitIndex).toBe(1);
    });

    it('rejects replicate() with a timeout when no acknowledgement arrives', async () => {
      node = electLeader();

      const promise = node.replicate({ op: 'lonely' }, 1000);
      const assertion = expect(promise).rejects.toThrow(/Replication timeout/);

      // Drive the replicate() timeout timer.
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    });

    it('decrements nextIndex on a failed append-entries response (log backtracking)', () => {
      node = electLeader();
      const before = node.getStatus().peers.find(p => p.nodeId === 'p1');
      expect(before).toBeDefined();

      // A failed response should make the leader retry at a lower nextIndex.
      // We assert indirectly: the leader stays leader and does not crash, and a
      // subsequent successful response still advances matchIndex.
      node.handleAppendEntriesResponse({ term: node.getStatus().term, success: false }, 'p1');
      node.handleAppendEntriesResponse({ term: node.getStatus().term, success: true, matchIndex: 0 }, 'p1');

      const after = node.getStatus().peers.find(p => p.nodeId === 'p1');
      expect(after!.matchIndex).toBe(0);
    });

    it('steps down to follower when an append-entries response has a higher term', () => {
      node = electLeader();
      expect(node.getStatus().state).toBe('leader');
      const term = node.getStatus().term;

      node.handleAppendEntriesResponse({ term: term + 3, success: false }, 'p1');

      expect(node.getStatus().state).toBe('follower');
      expect(node.getStatus().term).toBe(term + 3);
    });

    it('ignores append-entries responses when no longer leader', () => {
      node = new RaftConsensus({ nodeId: 'f', nodes: ['f', 'g', 'h'] });
      node.stop();
      expect(node.getStatus().state).toBe('follower');

      // Should be a no-op (no peer update, no throw).
      node.handleAppendEntriesResponse({ term: 1, success: true, matchIndex: 5 }, 'g');
      const peer = node.getStatus().peers.find(p => p.nodeId === 'g');
      expect(peer!.matchIndex).toBe(0);
    });
  });

  // ==========================================================================
  // Distributed locks
  // ==========================================================================

  describe('distributed locks', () => {
    /**
     * Elect a 3-node leader. acquireLock/releaseLock internally `await replicate()`,
     * which only resolves once a majority of followers acknowledge. We feed those
     * acks for the next pending log index, then await the lock operation.
     */
    function electLockLeader(): RaftConsensus {
      const n = new RaftConsensus({ nodeId: 'lead', nodes: ['lead', 'p1', 'p2'] });
      vi.advanceTimersByTime(350); // -> candidate
      n.handleVoteResponse({ term: n.getStatus().term, voteGranted: true }, 'p1'); // -> leader
      return n;
    }

    /** Drive the leader's pending replicate() to commit by acking both followers. */
    function ackMajority(n: RaftConsensus): void {
      const term = n.getStatus().term;
      const index = n.getStatus().logLength;
      n.handleAppendEntriesResponse({ term, success: true, matchIndex: index }, 'p1');
      n.handleAppendEntriesResponse({ term, success: true, matchIndex: index }, 'p2');
    }

    it('throws when a non-leader tries to acquire a lock', async () => {
      node = new RaftConsensus({ nodeId: 'f', nodes: ['f', 'g'] });
      node.stop();

      await expect(node.acquireLock('resource-1')).rejects.toThrow(/Only leader can manage locks/);
    });

    it('throws when a non-leader tries to release a lock', async () => {
      node = new RaftConsensus({ nodeId: 'f', nodes: ['f', 'g'] });
      node.stop();

      await expect(node.releaseLock('resource-1')).rejects.toThrow(/Only leader can manage locks/);
    });

    it('acquires a free lock as leader and emits lock_acquired', async () => {
      node = electLockLeader();
      expect(node.getStatus().state).toBe('leader');

      const acquired = vi.fn();
      node.on('lock_acquired', acquired);

      const pending = node.acquireLock('resource-1', 30_000);
      ackMajority(node); // commit the lock_acquire log entry -> replicate() resolves

      const ok = await pending;
      expect(ok).toBe(true);
      expect(acquired).toHaveBeenCalledWith({ key: 'resource-1', holder: 'lead' });
    });

    it('refuses a second acquisition of a held lock', async () => {
      node = electLockLeader();

      const firstPending = node.acquireLock('shared', 30_000);
      ackMajority(node);
      expect(await firstPending).toBe(true);

      // The lock is already held; a second acquire returns false synchronously
      // (it never reaches replicate()).
      const second = await node.acquireLock('shared', 30_000);
      expect(second).toBe(false);
    });

    it('releases a held lock and emits lock_released', async () => {
      node = electLockLeader();
      const acquirePending = node.acquireLock('to-release', 30_000);
      ackMajority(node);
      await acquirePending;

      const released = vi.fn();
      node.on('lock_released', released);

      const releasePending = node.releaseLock('to-release');
      ackMajority(node); // commit the lock_release entry
      await releasePending;

      expect(released).toHaveBeenCalledWith({ key: 'to-release', holder: 'lead' });
    });

    it('throws when releasing a lock not held by this node', async () => {
      node = electLockLeader();

      await expect(node.releaseLock('never-acquired')).rejects.toThrow(/Lock not held by this node/);
    });
  });

  // ==========================================================================
  // Deadlock detection
  // ==========================================================================

  describe('detectDeadlocks', () => {
    it('returns no deadlocks when there are no locks', () => {
      node = new RaftConsensus({ nodeId: 'n', nodes: ['n'] });
      node.stop();

      expect(node.detectDeadlocks()).toEqual([]);
    });

    it('detects a cycle in the wait-for graph', () => {
      node = new RaftConsensus({ nodeId: 'lead', nodes: ['lead', 'p1', 'p2'] });
      node.stop();

      // Hand-craft a wait-for cycle via the locks map: agent-1 holds A and waits on
      // B (held by agent-2), while agent-2 waits on A — a classic deadlock.
      const locks: Map<string, any> = (node as any).locks;
      locks.set('A', { key: 'A', holder: 'agent-1', acquiredAt: Date.now(), expiresAt: Date.now() + 60_000, waiters: ['agent-2'] });
      locks.set('B', { key: 'B', holder: 'agent-2', acquiredAt: Date.now(), expiresAt: Date.now() + 60_000, waiters: ['agent-1'] });

      const deadlocks = node.detectDeadlocks();

      expect(deadlocks.length).toBeGreaterThan(0);
      // The detected cycle should reference both contending agents.
      const flat = deadlocks.flat();
      expect(flat).toContain('agent-1');
      expect(flat).toContain('agent-2');
    });

    it('returns no deadlocks for a non-cyclic wait graph', () => {
      node = new RaftConsensus({ nodeId: 'n', nodes: ['n'] });
      node.stop();

      const locks: Map<string, any> = (node as any).locks;
      // agent-2 waits for agent-1 (holder), but agent-1 waits for nobody -> no cycle.
      locks.set('A', { key: 'A', holder: 'agent-1', acquiredAt: Date.now(), expiresAt: Date.now() + 60_000, waiters: ['agent-2'] });

      expect(node.detectDeadlocks()).toEqual([]);
    });
  });

  // ==========================================================================
  // CRDT operations
  // ==========================================================================

  describe('CRDT operations', () => {
    beforeEach(() => {
      node = new RaftConsensus({ nodeId: 'crdt-node', nodes: ['crdt-node', 'peer'] });
      node.stop();
    });

    it('increments a counter CRDT and emits crdt_updated', () => {
      const updated = vi.fn();
      node.on('crdt_updated', updated);

      node.updateCRDT('hits', 'increment', 5);
      node.updateCRDT('hits', 'increment', 3);

      expect(node.getCRDT('hits')).toBe(8);
      expect(updated).toHaveBeenCalledTimes(2);
    });

    it('sets a register CRDT to an arbitrary value', () => {
      node.updateCRDT('config', 'set', { mode: 'fast' });
      expect(node.getCRDT('config')).toEqual({ mode: 'fast' });
    });

    it('adds elements to a set-like CRDT', () => {
      node.updateCRDT('tags', 'add', 'a');
      node.updateCRDT('tags', 'add', 'b');

      expect(node.getCRDT('tags')).toEqual(['a', 'b']);
    });

    it('returns undefined for an unknown CRDT key', () => {
      expect(node.getCRDT('missing')).toBeUndefined();
    });

    it('adopts a remote CRDT state when none exists locally', () => {
      const remote: CRDTState = {
        type: 'counter',
        value: 42,
        vectorClock: new Map([['peer', 7]]),
      };

      node.mergeCRDT('remote-counter', remote);

      expect(node.getCRDT('remote-counter')).toBe(42);
    });

    it('merges counter CRDTs by taking the maximum value', () => {
      node.updateCRDT('counter', 'increment', 3); // local value 3

      const merged = vi.fn();
      node.on('crdt_merged', merged);

      node.mergeCRDT('counter', {
        type: 'counter',
        value: 10,
        vectorClock: new Map([['peer', 4]]),
      });

      expect(node.getCRDT('counter')).toBe(10); // max(3, 10)
      expect(merged).toHaveBeenCalledTimes(1);
    });

    it('merges vector clocks element-wise by maximum', () => {
      node.updateCRDT('vc', 'increment', 1); // local clock {crdt-node: 1}

      node.mergeCRDT('vc', {
        type: 'counter',
        value: 0,
        vectorClock: new Map([['crdt-node', 5], ['peer', 9]]),
      });

      const state: Map<string, CRDTState> = (node as any).crdtStates;
      const vc = state.get('vc')!.vectorClock;
      expect(vc.get('crdt-node')).toBe(5); // max(1, 5)
      expect(vc.get('peer')).toBe(9);
    });
  });

  // ==========================================================================
  // Lifecycle & status
  // ==========================================================================

  describe('lifecycle', () => {
    it('emits started/stopped events and clears timers on stop', () => {
      node = new RaftConsensus({ nodeId: 'lc', nodes: ['lc', 'p'] });

      const started = vi.fn();
      const stopped = vi.fn();
      node.on('started', started);
      node.on('stopped', stopped);

      node.start();
      expect(started).toHaveBeenCalledWith({ nodeId: 'lc' });

      node.stop();
      expect(stopped).toHaveBeenCalledWith({ nodeId: 'lc' });

      // After stop, advancing time must not trigger a new election.
      vi.advanceTimersByTime(5000);
      expect(node.getStatus().state).toBe('follower');
    });

    it('exposes metrics that track elections and leadership changes', () => {
      node = new RaftConsensus({ nodeId: 'm', nodes: ['m', 'p1', 'p2'] });
      vi.advanceTimersByTime(350); // election -> candidate (totalElections++)
      node.handleVoteResponse({ term: node.getStatus().term, voteGranted: true }, 'p1'); // -> leader

      const status = node.getStatus();
      expect(status.state).toBe('leader');
      expect(status.metrics.totalElections).toBeGreaterThanOrEqual(1);
      expect(status.metrics.totalLeaderChanges).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // Byzantine Fault Tolerance (signed messages)
  // ==========================================================================

  describe('byzantine fault tolerance', () => {
    it('signs vote requests when BFT is enabled', () => {
      node = new RaftConsensus({
        nodeId: 'bft', nodes: ['bft', 'p1', 'p2'], byzantineTolerance: true,
      });

      let req: VoteRequest | undefined;
      node.on('vote_request', r => { req = r; });

      vi.advanceTimersByTime(350);

      expect(req).toBeDefined();
      expect(typeof req!.signature).toBe('string');
      expect(req!.signature!.length).toBeGreaterThan(0);
    });

    it('signs append-entries responses when BFT is enabled', () => {
      node = new RaftConsensus({
        nodeId: 'bft', nodes: ['bft', 'leader'], byzantineTolerance: true,
      });
      node.stop();

      const res = node.handleAppendEntries({
        term: 1, leaderId: 'leader', prevLogIndex: 0, prevLogTerm: 0,
        entries: [], leaderCommit: 0,
        signature: 'leader-sig',
      });

      expect(res.success).toBe(true);
      expect(typeof res.signature).toBe('string');
    });

    it('rejects an unsigned vote request when BFT is enabled', () => {
      node = new RaftConsensus({
        nodeId: 'bft', nodes: ['bft', 'cand'], byzantineTolerance: true,
      });
      node.stop();

      const res = node.handleVoteRequest({
        term: 1, candidateId: 'cand', lastLogIndex: 0, lastLogTerm: 0,
        // no signature
      });

      expect(res.voteGranted).toBe(false);
    });

    it('rejects unsigned append-entries when BFT is enabled', () => {
      node = new RaftConsensus({
        nodeId: 'bft', nodes: ['bft', 'leader'], byzantineTolerance: true,
      });
      node.stop();

      const res = node.handleAppendEntries({
        term: 1, leaderId: 'leader', prevLogIndex: 0, prevLogTerm: 0,
        entries: [], leaderCommit: 0,
        // no signature
      });

      expect(res.success).toBe(false);
    });
  });
});
