// charter: dispatch
// coordination_consensus mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<CoordinationConsensusPayload>` so every consensus
// transition (status / propose / vote / commit) flows through the archivist's
// audit-chain (intent → applied | rejected) with guard verdicts + invariant
// verdicts recorded.
//
// Distinction from `hive-mind_consensus` (handlers/hive-mind/consensus.ts):
//   - `hive-mind_consensus` mutates `state.consensus` under `hive-state.json` —
//     the hive's worker-coordinated proposals (BFT/Raft/Quorum/Gossip/CRDT).
//   - `coordination_consensus` (this handler) mutates `store.consensus` under
//     `.claude-flow/coordination/store.json` — the topology-level consensus
//     proposals (BFT/Raft/Quorum only at the cli surface). Different store,
//     different STORE_ID, same audit-chain shape.
//
// Why mixed-mode actions register as ONE mutation handler:
//   - status:  reads `consensus.pending` or `consensus.history` lookup. Pure
//              read shape (no `saveCoordStore`), but flows through the mutation
//              registration so there is exactly one registry entry per cli tool
//              name (consensus.ts precedent).
//   - propose: mutates `consensus.pending` — new proposal record. Raft-strategy
//              one-pending-per-term invariant enforced inline (today as a
//              `success: false` early return; should become a typed invariant
//              violation under Phase 5 wire-up per `feedback-no-fallbacks`).
//   - vote:    mutates `consensus.pending[*].votes` and (on resolution) moves
//              the proposal to `consensus.history` with byzantine-voter
//              detection for BFT.
//   - commit:  no-op confirmation against `consensus.history`. Pure read shape
//              today (returns success/failure without mutation), but flows
//              through the mutation registration alongside the other actions.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/coordination-tools.ts`
// `coordination_consensus` handler — load → action-switch → mutate →
// `saveCoordStore`. The cli callsite stays in place until the dispatch boundary
// is wired through cli; this file establishes the registration shape.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/coordination/store.json` (consensus subtree) may mutate. The
// underlying primitive is `makeFsJsonSubstrate` (substrates/fs-json-store.ts),
// shared with the other five `coordination_*` mutation handlers.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/** Consensus strategy at the coordination surface — matches the CLI inputSchema
 *  enum (line 505 of coordination-tools.ts). Narrower than hive-mind's set
 *  (no gossip/crdt/weighted at this surface). */
export type CoordinationConsensusStrategy = 'bft' | 'raft' | 'quorum';

/** Quorum threshold preset — only meaningful for `strategy: 'quorum'`. */
export type CoordinationQuorumPreset = 'unanimous' | 'majority' | 'supermajority';

/** Action discriminator — mirrors the cli tool's inputSchema.action enum. */
export type CoordinationConsensusAction = 'status' | 'propose' | 'vote' | 'commit';

/** Vote payload — `'accept'` maps to internal `true`, `'reject'` to `false`. */
export type CoordinationVote = 'accept' | 'reject';

/**
 * Mutation payload mirroring the CLI tool's `coordination_consensus` input
 * shape (coordination-tools.ts inputSchema lines 499-507). All fields optional
 * except as required by action; the cli's defaults are `action='status'`,
 * `strategy='raft'`, `quorumPreset='majority'`, `term=1`.
 */
export interface CoordinationConsensusPayload {
  readonly action?: CoordinationConsensusAction;
  readonly proposal?: unknown;
  readonly proposalId?: string;
  readonly vote?: CoordinationVote;
  readonly voterId?: string;
  readonly strategy?: CoordinationConsensusStrategy;
  readonly quorumPreset?: CoordinationQuorumPreset;
  readonly term?: number;
}

const STORE_ID = 'coordination_consensus' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the action-switch body of
// coordination-tools.ts `coordination_consensus` callsite once the dispatch
// boundary is wired through cli. The wrapper-in-cli pattern (loadCoordStore →
// initialize `store.consensus` if missing → action-switch → mutate →
// saveCoordStore via direct writeFileSync) collapses to a single
// `ctx.substrate.withWrite` here because `makeFsJsonSubstrate` owns the lock
// semantics.
//
// Two correctness gates the invariants-author should encode:
//   1. Raft one-pending-per-term: at most one entry in `consensus.pending` with
//      `(strategy='raft', term=T)`. The cli enforces this via early return; it
//      should be a typed invariant.
//   2. BFT byzantine-voter detection: when a voter casts conflicting votes
//      across proposals (or within a single proposal), the cli records them on
//      `p.byzantineVoters[]` and invalidates the vote. The audit-chain should
//      capture this as a guard verdict rather than a silent invalidation.
export const consensusCoordinationHandler: GuardedWrite<CoordinationConsensusPayload> =
  registerMutationHandler<CoordinationConsensusPayload>(
    'coordination_consensus',
    async (ctx: MutationContext<false>, _payload: CoordinationConsensusPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: coordination_consensus handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/coordination-tools.ts ' +
          '\'coordination_consensus\' handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
