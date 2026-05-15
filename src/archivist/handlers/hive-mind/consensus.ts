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

// TODO(ADR-0180 Phase 4 wire-up): port the action-switch body of
// hive-mind-tools.ts `hive-mind_consensus` callsite once the dispatch boundary
// is wired through cli. The wrapper-in-cli pattern (loadHiveState → action-
// switch → mutate → saveHiveState under `withHiveStoreLock`) collapses to a
// single `ctx.substrate.withWrite` here because the primitive owns the lock
// semantics. The cli's outer call to `withHiveStoreLock` becomes redundant and
// is removed in the same commit that flips the dispatch wire-up.
//
// Strategy-specific branches (ADR-0119 weighted, ADR-0120 gossip, ADR-0121
// CRDT, ADR-0131 auto-status-transition) port verbatim — they all reduce to
// "read state, mutate accumulator, write state" which is exactly one substrate
// write per call. The CRDT branch's `mergeCRDTState(before, voterSnapshot)` is
// pure JSON merging; no special substrate path needed.
export const consensusHiveMindHandler: GuardedWrite<HiveMindConsensusPayload> =
  registerMutationHandler<HiveMindConsensusPayload>(
    'hive-mind_consensus',
    async (ctx: MutationContext<false>, _payload: HiveMindConsensusPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: hive-mind_consensus handler body pending Phase 4 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/hive-mind-tools.ts ' +
          '\'hive-mind_consensus\' handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
