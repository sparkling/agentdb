// charter: dispatch
// hive-mind_consensus mutation handler (ADR-0180 Phase 4 §Architecture · Audit chain).
// Registers as `GuardedWrite<HiveMindConsensusPayload>` so every consensus
// transition (propose / vote / status-with-timeout-settle / list) flows
// through the archivist's audit-chain with guard verdicts + invariant verdicts
// recorded.
//
// Why mixed-mode actions register as ONE mutation handler:
//   - propose: mutates `state.consensus.pending` (new proposal).
//   - vote:    mutates `state.consensus.pending[*].votes` and (on resolution)
//              moves the proposal to `state.consensus.history`.
//   - status:  CAN mutate. ADR-0131 (T12) auto-status-transition writes
//              `proposal.status = 'failed-quorum-not-reached'` and appends to
//              `state.consensus.history` when `Date.now() >= timeoutAt`. Gossip
//              (ADR-0120) and CRDT (ADR-0121) status paths also force-settle
//              and persist via `saveHiveState`. Treating status as a pure read
//              would bypass the audit-chain for these mutations — wrong shape.
//   - list:   read-only enumeration of pending + recentHistory. The dispatch
//              boundary may short-circuit to a read in a later phase; today it
//              flows through the mutation registration alongside the others so
//              there is exactly one registry entry per cli tool name.
//
// Per ADR-0121 (T3): CRDT-strategy vote is a CvRDT merge — `mergeCRDTState`
// is a pure function over JSON (G-Counter / OR-Set / LWW-Register merges are
// commutative, associative, idempotent). Persistence is one substrate write
// structurally identical to BFT/Raft/Quorum/Weighted tally save —
// `ctx.substrate.withWrite<T>(fn)` covers all five strategies uniformly.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/hive-mind-tools.ts`
// `hive-mind_consensus` handler — load → action-switch → mutate →
// `saveHiveState` under `withHiveStoreLock` (lock semantics restored by
// commit 5f02fd290 "fix(hive-mind): wrap agents.json writes in
// withHiveStoreLock (pre-Phase 4)"). The cli callsite stays in place until
// the dispatch boundary is wired through cli; this file establishes the
// registration shape the dispatch path will resolve.
//
// Provenance rollout: `inputSchema.includeProvenance` is added in the cli
// (companion edit) so status/list response shapes can opt into the full
// RankedResult provenance carry per ADR-0180 §Read-path return shape. The
// archivist's audit-chain populates provenance for read-shaped responses
// regardless; the schema flag controls cli-side flattening only.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `state.consensus` may mutate. Direct fs writes are forbidden by the
// `no-restricted-imports` backstop and the path-restricted
// substrate-internal.ts seam (ADR-0180 §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';
import { handleBftConsensus } from './consensus/bft.js';
import { handleRaftConsensus } from './consensus/raft.js';
import { handleQuorumConsensus } from './consensus/quorum.js';
import { handleWeightedConsensus } from './consensus/weighted.js';
import { handleGossipConsensus } from './consensus/gossip.js';
import { handleCrdtConsensus } from './consensus/crdt.js';
import {
  bftConsensusInvariants,
  raftConsensusInvariants,
  quorumConsensusInvariants,
  weightedConsensusInvariants,
  gossipConsensusInvariants,
  crdtConsensusInvariants,
} from '../../invariants/hive-mind/consensus/index.js';

/** Consensus strategy — matches the CLI inputSchema enum.
 *  'byzantine' is a wire-boundary alias for 'bft' (carry-forward from ADR-0106
 *  R1 per ADR-0118 review-notes-triage 2026-05-02); normalized at handler entry. */
export type ConsensusStrategy =
  | 'bft'
  | 'raft'
  | 'quorum'
  | 'weighted'
  | 'byzantine'
  | 'gossip'
  | 'crdt';

/** Quorum threshold preset — only meaningful for `strategy: 'quorum'`. */
export type QuorumPreset = 'unanimous' | 'majority' | 'supermajority';

/** Action discriminator — mirrors the cli tool's inputSchema.action enum. */
export type ConsensusAction = 'propose' | 'vote' | 'status' | 'list';

/**
 * Mutation payload — discriminated by `action`. Mirrors the cli tool's
 * inputSchema (lines 1816-1847 of `hive-mind-tools.ts`) with one addition:
 * `includeProvenance` opts the status/list response shapes into full
 * RankedResult provenance carry (ADR-0180 §Read-path return shape, rollout
 * scope per Open Follow-up #provenance).
 */
export type HiveMindConsensusPayload =
  | {
      readonly action: 'propose';
      readonly type?: string;
      readonly value?: unknown;
      readonly strategy?: ConsensusStrategy;
      readonly quorumPreset?: QuorumPreset;
      readonly term?: number;
      readonly timeoutMs?: number;
      readonly roundTimeoutMs?: number;
      readonly voterId?: string;
      /** Wave 6 cli pre-mint per ADR-0184 Wave 2 DA Concern 3 — sidesteps
       *  the pre/post-snapshot race for parallel propose calls (mirrors
       *  task_create's pre-minted taskId pattern). When omitted the handler
       *  mints `proposal-${Date.now()}-${rand}` (back-compat). */
      readonly proposalId?: string;
    }
  | {
      readonly action: 'vote';
      readonly proposalId: string;
      readonly voterId: string;
      readonly vote?: boolean;
      readonly strategy?: ConsensusStrategy;
      /** CRDT-only: optional `{ votes, approvers, verdict }` triple merged
       *  into the proposal accumulator. Validated at the cli boundary per
       *  `feedback-no-fallbacks.md` (malformed shapes throw, no silent coerce). */
      readonly crdtSnapshot?: unknown;
    }
  | {
      readonly action: 'status';
      readonly proposalId: string;
      /** ADR-0180 §Read-path return shape — opt into RankedResult provenance
       *  on the status response. Default `false` preserves the legacy flat shape. */
      readonly includeProvenance?: boolean;
    }
  | {
      readonly action: 'list';
      /** Same provenance flag as status — applies to both pending entries and
       *  recentHistory ranks. */
      readonly includeProvenance?: boolean;
    };

const STORE_ID = 'hive-mind_consensus' as StoreId;

/** Type-guard for the dispatch switch. Used when peeking at a stored
 *  proposal's `strategy` field for status/list dispatch — the on-disk shape
 *  is `string`, not the typed `ConsensusStrategy` union. */
function isKnownStrategy(
  s: string,
): s is 'bft' | 'raft' | 'quorum' | 'weighted' | 'gossip' | 'crdt' {
  return (
    s === 'bft' ||
    s === 'raft' ||
    s === 'quorum' ||
    s === 'weighted' ||
    s === 'gossip' ||
    s === 'crdt'
  );
}

// ADR-0184 Wave 1: parent dispatcher routes `payload.strategy` to per-strategy
// handler modules under `./consensus/<strategy>.ts`. Each per-strategy module's
// body is a `pending` throw until its wave (Wave 2 ports bft/raft/quorum, Wave
// 3 weighted, Wave 4 gossip, Wave 5 crdt). Wave 6 retires the cli surface.
//
// Strategy normalisation (`byzantine → bft`) happens once at the parent entry
// — mirroring cli `hive-mind-tools.ts` line 2056 (`input.strategy = 'bft'`).
// Because the wire payload type uses `readonly` fields, the normalised payload
// is built as a new object rather than mutating in place; per-strategy modules
// receive the normalised value via `normalisedPayload.strategy` and MUST NOT
// re-read the original `payload.strategy` carrying `'byzantine'` (per ADR-0184
// Wave 1 DA Axis (a) resolution).
//
// One `withWrite` scope wraps the entire dispatch — every action
// (propose/vote/status/list) needs the same `state.consensus` mutation surface
// and the substrate's O_EXCL lock is NOT reentrant. Per-strategy handlers are
// called inside the lock-held scope. `list` flows through `withWrite` per the
// existing doc-comment rationale; short-circuit to a read is a Wave 6+ decision.
//
// Per-strategy invariant arrays (`bftConsensusInvariants`, etc.) start empty in
// Wave 1; each wave grows its own array independently. The parent
// `registerMutationHandler` spreads all six at registration so wave-N additions
// pick up automatically without re-touching this file.
export const consensusHiveMindHandler: GuardedWrite<HiveMindConsensusPayload> =
  registerMutationHandler<HiveMindConsensusPayload>(
    'hive-mind_consensus',
    async (ctx: MutationContext<false>, payload: HiveMindConsensusPayload): Promise<void> => {
      // Normalise `byzantine → bft` at handler entry and apply the cli's
      // `'raft'` default when strategy is omitted. Build a new payload object
      // because the discriminated-union fields are `readonly`. Per-strategy
      // handlers receive this normalised payload and dispatch on its
      // `strategy` field; the original wire payload is no longer referenced.
      const rawStrategy =
        'strategy' in payload ? payload.strategy : undefined;
      const propStrategy: 'bft' | 'raft' | 'quorum' | 'weighted' | 'gossip' | 'crdt' =
        rawStrategy === 'byzantine'
          ? 'bft'
          : (rawStrategy ?? 'raft');

      // ADR-0184 Wave 2 DA Concern 1 resolution: per-strategy handlers receive
      // the parent's `handle` so each strategy's read/write happens within the
      // parent's single `withWrite` scope. The substrate O_EXCL lock is NOT
      // reentrant; the per-strategy bodies must not re-enter `withWrite`. One
      // `handle.write` per scope = one audit entry per call (ADR-0180
      // §Confirmation).
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        // For status/list, the payload has no `strategy` field — look up
        // the proposal's strategy from state so the per-strategy handler
        // sees a consistent value. `list` is strategy-agnostic but routes
        // through bft's handler (any strategy's list arm is a no-op);
        // `status` looks up the specific proposal.
        let strategy = propStrategy;
        if (payload.action === 'status') {
          const state = await handle.read<{
            consensus?: {
              pending?: Array<{ proposalId: string; strategy: string }>;
              history?: Array<{ proposalId: string; strategy: string }>;
            };
          }>({ storeId: STORE_ID, key: 'root' });
          const pending = state?.consensus?.pending ?? [];
          const history = state?.consensus?.history ?? [];
          const found =
            pending.find((p) => p.proposalId === payload.proposalId) ??
            history.find((h) => h.proposalId === payload.proposalId);
          if (found && isKnownStrategy(found.strategy)) {
            strategy = found.strategy;
          }
          // If proposal not found, fall through to the default (raft) so the
          // per-strategy handler throws ProposalNotFoundError with a coherent
          // strategy attribution.
        }

        const normalisedPayload = {
          ...payload,
          strategy,
        } as HiveMindConsensusPayload;

        switch (strategy) {
          case 'bft':
            return handleBftConsensus(ctx, handle, normalisedPayload);
          case 'raft':
            return handleRaftConsensus(ctx, handle, normalisedPayload);
          case 'quorum':
            return handleQuorumConsensus(ctx, handle, normalisedPayload);
          case 'weighted':
            return handleWeightedConsensus(ctx, handle, normalisedPayload);
          case 'gossip':
            return handleGossipConsensus(ctx, handle, normalisedPayload);
          case 'crdt':
            return handleCrdtConsensus(ctx, handle, normalisedPayload);
          default: {
            // Unknown strategy — per `feedback-no-fallbacks`, throw rather
            // than silently route to a default. Exhaustiveness checked via
            // `_exhaustive: never` so adding a new strategy without a case
            // arm fails the compile.
            const _exhaustive: never = strategy;
            throw new Error(
              `hive-mind_consensus: unknown strategy ${JSON.stringify(_exhaustive)}`,
            );
          }
        }
      });
    },
    {
      invariants: [
        ...bftConsensusInvariants,
        ...raftConsensusInvariants,
        ...quorumConsensusInvariants,
        ...weightedConsensusInvariants,
        ...gossipConsensusInvariants,
        ...crdtConsensusInvariants,
      ],
      cacheScope: 'global',
    },
  );
