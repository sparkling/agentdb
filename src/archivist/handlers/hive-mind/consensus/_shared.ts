// charter: dispatch
// Shared helpers for per-strategy hive-mind_consensus handlers (ADR-0184 Wave 2).
// Vendored from cli `hive-mind-tools.ts` (line numbers cited inline). The cli
// helpers stay load-bearing until Wave 6 retires the cli surface; this module
// is the agentdb-side copy that Wave 2-5 per-strategy bodies depend on.
//
// Per ADR-0184 Wave 2 DA Axis (e) carry-forward: `tryResolveProposal` contains
// a weighted-strategy branch (cli line 722-749) reused unchanged for Wave 3's
// weighted port — the same shared function serves all five non-gossip non-crdt
// strategies. The CRDT-specific and gossip-specific fields on `ConsensusProposal`
// are typed as `unknown` here so this module can land in Wave 2 without
// importing Wave 4/5 surfaces; Wave 5 will narrow `crdtState` to its proper
// shape when the crdt module lands.
//
// Per ADR-0184 Wave 2 DA Concern 2 carry-forward: cli soft-`{action, error}`
// returns become typed throws here — the archivist `Promise<void>` signature
// has no error-return path. Wave 6 cli flips catch these throws and reshape.

import type { SubstrateHandle, StoreId } from '../../../index.js';
import type {
  HiveMemoryEntry,
  HiveStateDoc,
} from '../hive-state.js';

/** Consensus strategy — re-exported from the parent for handler convenience. */
export type ConsensusStrategy =
  | 'bft'
  | 'raft'
  | 'quorum'
  | 'weighted'
  | 'gossip'
  | 'crdt';

/** Quorum threshold preset — only meaningful for `strategy: 'quorum'`. */
export type QuorumPreset = 'unanimous' | 'majority' | 'supermajority';

/**
 * Mirrors cli `ConsensusProposal` (hive-mind-tools.ts line 525-567). CRDT-/
 * gossip-specific fields are typed as `unknown` so Wave 2 can land without
 * importing Wave 4/5 surfaces; Wave 5 narrows `crdtState` when the crdt
 * module lands.
 */
export interface ConsensusProposal {
  proposalId: string;
  type: string;
  value: unknown;
  proposedBy: string;
  proposedAt: string;
  votes: Record<string, boolean>;
  status: 'pending' | 'approved' | 'rejected' | 'failed-quorum-not-reached';
  strategy: ConsensusStrategy;
  absentVoters?: string[];
  term?: number;
  quorumPreset?: QuorumPreset;
  byzantineVoters?: string[];
  timeoutAt?: string;
  /** Gossip-only fields (ADR-0120). Set to `undefined` on bft/raft/quorum/weighted/crdt. */
  gossipRound?: number;
  lastVoteChangedRound?: number;
  totalNodes?: number;
  currentRoundBroadcastSet?: string[];
  roundTimeoutMs?: number;
  roundStartedAt?: string;
  /** CRDT-only fields (ADR-0121). Wave 5 narrows the `unknown` type. */
  crdtState?: unknown;
  crdtExpectedVoters?: number;
}

/** Mirrors cli `ConsensusResult` (hive-mind-tools.ts line 569-584). */
export interface ConsensusHistoryRow {
  proposalId: string;
  type: string;
  result: 'approved' | 'rejected' | 'failed-quorum-not-reached';
  votes: { for: number; against: number };
  decidedAt: string;
  strategy: ConsensusStrategy;
  term?: number;
  byzantineDetected?: string[];
  absentVoters?: string[];
}

/** Per-worker failure metadata — mirrors cli `WorkerMeta` (cli line 269). */
export interface HiveWorkerMeta {
  failedAt: number | null;
  retryOf: string | null;
}

/**
 * Queen-weighted multiplier per ADR-0119 (T1). Defer the constant here so
 * Wave 3 weighted port + Wave 2 helpers share one source of truth. The
 * constant is also referenced by `tryResolveProposal`'s weighted branch.
 */
export const QUEEN_WEIGHT = 3;

/** Default Raft `timeoutMs` when caller omits the field. */
export const RAFT_TIMEOUT_MS_DEFAULT = 30_000;

/** Default gossip / CRDT per-round timeout — ADR-0120/0121. */
export const GOSSIP_ROUND_TIMEOUT_MS_DEFAULT = 5_000;

/** Singleton store ID — every consensus action operates on the hive state. */
export const CONSENSUS_STORE_ID = 'hive-mind_consensus' as StoreId;

/** Hive-state root key under the FS-JSON substrate. */
export const HIVE_STATE_ROOT_KEY = 'root';

// ── Error classes — typed throws replace cli soft-`{action,error}` returns. ──

/** A worker whose `failedAt !== null` attempted to vote. Per ADR-0131
 *  §Decision Outcome the re-admission throws synchronously. */
export class WorkerAlreadyFailedError extends Error {
  constructor(public readonly workerId: string, public readonly failedAt: number) {
    super(`hive-mind_consensus: worker ${workerId} already marked failed at ${new Date(failedAt).toISOString()} — re-admission rejected; spawn a new worker with retryOf`);
    this.name = 'WorkerAlreadyFailedError';
  }
}

/** Vote against a proposal already moved to history (terminal state, incl.
 *  'failed-quorum-not-reached'). Per ADR-0131 §Specification invariants. */
export class ProposalAlreadyFailedError extends Error {
  constructor(public readonly proposalId: string, public readonly result: string) {
    super(`hive-mind_consensus: proposal ${proposalId} is terminal (${result}); vote rejected`);
    this.name = 'ProposalAlreadyFailedError';
  }
}

/** Caller-supplied weighted-strategy proposal/vote without an elected queen.
 *  Vendored for Wave 3 weighted port; tryResolveProposal's weighted branch
 *  references it defensively. */
export class MissingQueenForWeightedConsensusError extends Error {
  constructor(public readonly action: string) {
    super(`hive-mind_consensus.${action}: weighted strategy requires an elected queen (state.queen is undefined)`);
    this.name = 'MissingQueenForWeightedConsensusError';
  }
}

/** Proposal not found (in pending or history) for a vote/status action. */
export class ProposalNotFoundError extends Error {
  constructor(public readonly proposalId: string, public readonly action: string) {
    super(`hive-mind_consensus.${action}: proposal ${proposalId} not found`);
    this.name = 'ProposalNotFoundError';
  }
}

/** voterId missing on a vote action. Cli returned a soft error; archivist throws. */
export class VoterIdRequiredError extends Error {
  constructor() {
    super('hive-mind_consensus.vote: voterId is required');
    this.name = 'VoterIdRequiredError';
  }
}

/** Raft term collision at propose — an existing pending proposal already
 *  holds this term. Carries `existingProposalId` so Wave 6 cli can reshape. */
export class RaftTermCollisionError extends Error {
  constructor(public readonly term: number, public readonly existingProposalId: string) {
    super(`hive-mind_consensus.propose: Raft term ${term} already has a pending proposal: ${existingProposalId}`);
    this.name = 'RaftTermCollisionError';
  }
}

/** Same voter cast same vote again. Bft path detects in-proposal equivocation
 *  separately (mutates byzantineVoters); raft/quorum throw this for the soft-
 *  reject path. */
export class DuplicateVoteError extends Error {
  constructor(public readonly voterId: string, public readonly proposalId: string, public readonly existingVote: boolean) {
    super(`hive-mind_consensus.vote: voter ${voterId} already cast the same vote on proposal ${proposalId}`);
    this.name = 'DuplicateVoteError';
  }
}

/** Raft voter attempts to change vote within the same term. Cli soft-error
 *  at line 2430-2438 — archivist throws. */
export class RaftVoteChangeError extends Error {
  constructor(public readonly voterId: string, public readonly term: number | undefined) {
    super(`hive-mind_consensus.vote: Raft voter ${voterId} cannot change vote in term ${term ?? '?'}`);
    this.name = 'RaftVoteChangeError';
  }
}

// ── Helpers — verbatim ports from cli hive-mind-tools.ts. ─────────────────

/**
 * Mirrors cli `isMemoryEntryShape` (hive-mind-tools.ts line 164-173). Detects
 * the four required-presence keys of a `HiveMemoryEntry`. Used by
 * `reconcileFailedFromStatusKeys` to skip legacy raw values.
 */
export function isHiveMemoryEntryShape(v: unknown): v is HiveMemoryEntry {
  if (v === null || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return (
    'type' in obj &&
    'ttlMs' in obj &&
    'expiresAt' in obj &&
    'createdAt' in obj
  );
}

/**
 * Mirrors cli `workerMetaFor` (hive-mind-tools.ts line 447-463). Returns the
 * `HiveWorkerMeta` for a worker, defaulting missing entries to
 * `{failedAt: null, retryOf: null}`. Mutations through this helper are
 * persisted by the next `handle.write`.
 */
export function workerMetaFor(state: HiveStateDoc, workerId: string): HiveWorkerMeta {
  if (!state.workerMeta) state.workerMeta = {};
  const existing = state.workerMeta[workerId];
  if (existing === undefined) {
    const fresh: HiveWorkerMeta = { failedAt: null, retryOf: null };
    state.workerMeta[workerId] = fresh;
    return fresh;
  }
  const writable = existing as Partial<HiveWorkerMeta> & HiveWorkerMeta;
  if (writable.failedAt === undefined) writable.failedAt = null;
  if (writable.retryOf === undefined) writable.retryOf = null;
  return writable;
}

/**
 * Mirrors cli `reconcileFailedFromStatusKeys` (hive-mind-tools.ts line 507-523).
 * Scans `state.sharedMemory` for `worker-<id>-status: 'absent'` markers (per
 * ADR-0131 §6 prompt protocol) and propagates absences into
 * `state.workerMeta[workerId].failedAt`. Returns true if any worker was newly
 * marked failed — caller must persist via the surrounding `handle.write`.
 */
export function reconcileFailedFromStatusKeys(
  state: HiveStateDoc,
  now: number = Date.now(),
): boolean {
  let mutated = false;
  for (const [key, entry] of Object.entries(state.sharedMemory)) {
    const m = key.match(/^worker-(.+)-status$/);
    if (!m) continue;
    if (!isHiveMemoryEntryShape(entry)) continue;
    if (entry.value !== 'absent') continue;
    const workerId = m[1] as string;
    const meta = workerMetaFor(state, workerId);
    if (meta.failedAt === null) {
      meta.failedAt = now;
      mutated = true;
    }
  }
  return mutated;
}

/**
 * Mirrors cli `calculateRequiredVotes` (hive-mind-tools.ts line 594-649). No
 * silent majority fallback — unknown strategies throw per
 * `feedback-no-fallbacks.md`.
 *
 * Per ADR-0184 Wave 2 DA Axis (e): the weighted arm reads `queenWeight` for
 * Wave 3's weighted port; bft/raft/quorum callers don't reach it. The crdt
 * and gossip arms return a nominal `totalNodes` so telemetry-readers get a
 * coherent value; their settle predicates ignore the result.
 */
export function calculateRequiredVotes(
  strategy: ConsensusStrategy,
  totalNodes: number,
  quorumPreset: QuorumPreset = 'majority',
  queenWeight: number = QUEEN_WEIGHT,
): number {
  if (totalNodes <= 0) return 1;
  switch (strategy) {
    case 'bft':
      return Math.floor((totalNodes * 2) / 3) + 1;
    case 'raft':
      return Math.floor(totalNodes / 2) + 1;
    case 'quorum':
      switch (quorumPreset) {
        case 'unanimous':
          return totalNodes;
        case 'supermajority':
          return Math.floor((totalNodes * 2) / 3) + 1;
        case 'majority':
        default:
          return Math.floor(totalNodes / 2) + 1;
      }
    case 'weighted': {
      const totalWorkers = Math.max(0, totalNodes - 1);
      return totalWorkers + queenWeight;
    }
    case 'crdt':
      return Math.max(1, totalNodes);
    case 'gossip':
      return Math.max(1, totalNodes);
    default: {
      const _exhaustive: never = strategy;
      throw new Error(`hive-mind_consensus: unknown strategy ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Mirrors cli `weightedTally` (hive-mind-tools.ts line 658-671). Compute
 * weighted vote tally — queen contributes `queenWeight`, workers contribute 1.
 * Vendored in Wave 2 because `tryResolveProposal` calls it; the dedicated
 * Wave 3 weighted handler will also call it.
 */
export function weightedTally(
  proposal: ConsensusProposal,
  queenId: string,
  queenWeight: number = QUEEN_WEIGHT,
): { votesFor: number; votesAgainst: number } {
  let votesFor = 0;
  let votesAgainst = 0;
  for (const [voterId, vote] of Object.entries(proposal.votes)) {
    const contribution = voterId === queenId ? queenWeight : 1;
    if (vote) votesFor += contribution;
    else votesAgainst += contribution;
  }
  return { votesFor, votesAgainst };
}

/**
 * Mirrors cli `detectByzantineVoters` (hive-mind-tools.ts line 680-695).
 * Detects cross-proposal conflicting votes for the same `type` within the
 * pending set — Byzantine behaviour per ADR-0098.
 */
export function detectByzantineVoters(
  pending: ConsensusProposal[],
  currentProposal: ConsensusProposal,
  voterId: string,
  newVote: boolean,
): boolean {
  for (const p of pending) {
    if (p.proposalId === currentProposal.proposalId) continue;
    if (p.type !== currentProposal.type) continue;
    if (voterId in p.votes && p.votes[voterId] !== newVote) {
      return true;
    }
  }
  return false;
}

/**
 * Mirrors cli `tryResolveProposal` (hive-mind-tools.ts line 711-772).
 * Returns 'approved' / 'rejected' / null. Handles:
 *   - weighted strategy with queen-weighted tally + deadlock arithmetic
 *   - unanimous-quorum-with-any-against → immediate reject
 *   - generic deadlock detection (remaining votes can't tip either side)
 *
 * Per ADR-0184 Wave 2 DA Axis (e): the weighted arm is unreachable from
 * Wave 2 callers (bft/raft/quorum). Wave 3 weighted port will reach it.
 */
export function tryResolveProposal(
  proposal: ConsensusProposal,
  totalNodes: number,
  queenId?: string,
): 'approved' | 'rejected' | null {
  const required = calculateRequiredVotes(
    proposal.strategy,
    totalNodes,
    proposal.quorumPreset,
  );

  if (proposal.strategy === 'weighted') {
    if (!queenId) {
      throw new MissingQueenForWeightedConsensusError('resolve');
    }
    const { votesFor, votesAgainst } = weightedTally(proposal, queenId);

    if (votesFor >= required) return 'approved';
    if (votesAgainst >= required) return 'rejected';

    const castVoters = new Set(Object.keys(proposal.votes));
    const queenStillUncast = !castVoters.has(queenId);
    const workersAlreadyCast = Array.from(castVoters).filter((v) => v !== queenId).length;
    const totalWorkers = Math.max(0, totalNodes - 1);
    const workerSlotsRemaining = Math.max(0, totalWorkers - workersAlreadyCast);
    const weightedRemaining = workerSlotsRemaining + (queenStillUncast ? QUEEN_WEIGHT : 0);

    if (
      votesFor + weightedRemaining < required &&
      votesAgainst + weightedRemaining < required
    ) {
      return 'rejected';
    }

    return null;
  }

  const votesFor = Object.values(proposal.votes).filter((v) => v).length;
  const votesAgainst = Object.values(proposal.votes).filter((v) => !v).length;

  if (votesFor >= required) return 'approved';
  if (votesAgainst >= required) return 'rejected';

  if (proposal.strategy === 'quorum' && proposal.quorumPreset === 'unanimous' && votesAgainst > 0) {
    return 'rejected';
  }

  const totalVotes = Object.keys(proposal.votes).length;
  const remaining = totalNodes - totalVotes;
  if (votesFor + remaining < required && votesAgainst + remaining < required) {
    return 'rejected';
  }

  return null;
}

/**
 * Load the hive-state document. Wraps the substrate-handle `read` so all
 * per-strategy handlers share the same shape and the load-failure mode
 * (`state === undefined` → `null` cast) is centralised.
 */
export async function loadHiveStateFromHandle(handle: SubstrateHandle): Promise<HiveStateDoc | null> {
  const state = await handle.read<HiveStateDoc>({
    storeId: CONSENSUS_STORE_ID,
    key: HIVE_STATE_ROOT_KEY,
  });
  return state ?? null;
}

/**
 * Persist the hive-state document. Single `handle.write` per per-strategy
 * body — accumulates all in-memory mutations (reconcile + vote + auto-status-
 * transition) into one substrate write per ADR-0184 Wave 2 DA Axis (g):
 * one write per audit entry, no intermediate `handle.write` calls.
 */
export async function saveHiveStateToHandle(
  handle: SubstrateHandle,
  state: HiveStateDoc,
): Promise<void> {
  await handle.write({
    storeId: CONSENSUS_STORE_ID,
    key: HIVE_STATE_ROOT_KEY,
    payload: state,
  });
}

/**
 * Ensure `state.consensus` is initialised — defensive against legacy state
 * files that pre-date the consensus surface.
 */
export function ensureConsensusContainer(state: HiveStateDoc): {
  pending: ConsensusProposal[];
  history: ConsensusHistoryRow[];
} {
  if (!state.consensus) {
    state.consensus = { pending: [], history: [] };
  }
  const consensus = state.consensus as {
    pending: ConsensusProposal[];
    history: ConsensusHistoryRow[];
  };
  if (!Array.isArray(consensus.pending)) consensus.pending = [];
  if (!Array.isArray(consensus.history)) consensus.history = [];
  return consensus;
}
