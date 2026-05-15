// charter: dispatch
// coordination_load_balance mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<CoordinationLoadBalancePayload>` so every load-balance
// transition (get / set / distribute) flows through the archivist's audit-chain
// (intent → applied | rejected) with guard verdicts + invariant verdicts recorded.
//
// Why mixed-mode actions register as ONE mutation handler (mirrors hive-mind/
// consensus.ts precedent):
//   - get:        reads `store.loadBalance` and computes aggregate node load.
//                 Pure read shape, but flows through the mutation registration so
//                 there is exactly one registry entry per cli tool name.
//   - set:        mutates `store.loadBalance.{algorithm,weights}`.
//   - distribute: MUTATES — picks a node by algorithm and increments
//                 `store.nodes[selected].load`. Reads dressed as a query in the cli
//                 schema, but the side effect (load counter increment) is exactly
//                 the kind of mutation the audit-chain is designed to record.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/coordination-tools.ts`
// `coordination_load_balance` handler — load → action-switch → mutate →
// `saveCoordStore`. The cli callsite stays in place until the dispatch boundary
// is wired through cli; this file establishes the registration shape.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/coordination/store.json` may mutate. The underlying primitive
// is `makeFsJsonSubstrate` (substrates/fs-json-store.ts), shared with the other
// five `coordination_*` mutation handlers — all six route through the same
// FS-JSON store under one cross-process O_EXCL sentinel lock.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/** Load-balancing algorithm — matches the CLI inputSchema enum. */
export type LoadBalanceAlgorithm =
  | 'round-robin'
  | 'least-connections'
  | 'weighted'
  | 'adaptive';

/** Action discriminator — mirrors the cli tool's inputSchema.action enum. */
export type CoordinationLoadBalanceAction = 'get' | 'set' | 'distribute';

/**
 * Mutation payload mirroring the CLI tool's `coordination_load_balance` input
 * shape (coordination-tools.ts inputSchema lines 208-214). All fields optional
 * except `action`; `action` defaults to `'get'` at the wire-up callsite.
 */
export interface CoordinationLoadBalancePayload {
  readonly action?: CoordinationLoadBalanceAction;
  readonly algorithm?: LoadBalanceAlgorithm;
  readonly weights?: Readonly<Record<string, number>>;
  readonly task?: string;
}

const STORE_ID = 'coordination_load_balance' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the action-switch body of
// coordination-tools.ts `coordination_load_balance` callsite once the dispatch
// boundary is wired through cli. The wrapper-in-cli pattern (loadCoordStore →
// action-switch → mutate → saveCoordStore via direct writeFileSync) collapses
// to a single `ctx.substrate.withWrite` here because `makeFsJsonSubstrate` owns
// the lock semantics. Note: `distribute` increments `nodes[id].load` —
// invariants-author should record this is a counter mutation, not a
// configuration mutation.
export const loadBalanceCoordinationHandler: GuardedWrite<CoordinationLoadBalancePayload> =
  registerMutationHandler<CoordinationLoadBalancePayload>(
    'coordination_load_balance',
    async (ctx: MutationContext<false>, _payload: CoordinationLoadBalancePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: coordination_load_balance handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/coordination-tools.ts ' +
          '\'coordination_load_balance\' handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
