// charter: dispatch
// coordination_node mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<CoordinationNodePayload>` so every node-roster
// transition (list / add / remove / heartbeat / status / info) flows through
// the archivist's audit-chain (intent → applied | rejected) with guard verdicts
// + invariant verdicts recorded.
//
// Why mixed-mode actions register as ONE mutation handler (mirrors hive-mind/
// consensus.ts precedent):
//   - list / status / info: read `store.nodes` — aggregate, single-node, or
//                            health-rolled-up. Pure read shape, but flows
//                            through the mutation registration so there is
//                            exactly one registry entry per cli tool name.
//   - add:                   mutates `store.nodes[nodeId]` (new active record
//                            with load=0, lastHeartbeat=now).
//   - remove:                mutates `store.nodes` (delete by id).
//   - heartbeat:             mutates `store.nodes[id].{lastHeartbeat,status}`.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/coordination-tools.ts`
// `coordination_node` handler — load → action-switch → mutate → `saveCoordStore`.
// The cli callsite stays in place until the dispatch boundary is wired through
// cli; this file establishes the registration shape.
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

/** Node lifecycle status persisted alongside each node record. The cli emits
 *  `'active'` on add/heartbeat; future agents may emit `'degraded' | 'offline'`. */
export type NodeStatus = 'active' | 'degraded' | 'offline';

/** Action discriminator — mirrors the cli tool's inputSchema.action enum. */
export type CoordinationNodeAction =
  | 'list'
  | 'add'
  | 'remove'
  | 'heartbeat'
  | 'status'
  | 'info';

/**
 * Mutation payload mirroring the CLI tool's `coordination_node` input shape
 * (coordination-tools.ts inputSchema lines 368-371). `action` defaults to
 * `'list'` at the wire-up callsite; `nodeId` defaults to `node-<Date.now()>`
 * on `'add'` when absent (mirroring the cli's `(input.nodeId as string) ||
 * \`node-\${Date.now()}\`` shape).
 */
export interface CoordinationNodePayload {
  readonly action?: CoordinationNodeAction;
  readonly nodeId?: string;
  readonly status?: NodeStatus;
}

const STORE_ID = 'coordination_node' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the action-switch body of
// coordination-tools.ts `coordination_node` callsite once the dispatch
// boundary is wired through cli. The wrapper-in-cli pattern (loadCoordStore →
// action-switch → mutate → saveCoordStore via direct writeFileSync) collapses
// to a single `ctx.substrate.withWrite` here because `makeFsJsonSubstrate` owns
// the lock semantics.
//
// Note for invariants-author: the cli's `heartbeat` is conditional on
// `store.nodes[nodeId]` existing — it silently no-ops for unknown nodeIds and
// still returns `{ success: true }`. Per `feedback-no-fallbacks` this should
// either fail loud or be made explicit in an invariant. Surface the call site
// during wire-up.
export const nodeCoordinationHandler: GuardedWrite<CoordinationNodePayload> =
  registerMutationHandler<CoordinationNodePayload>(
    'coordination_node',
    async (ctx: MutationContext<false>, _payload: CoordinationNodePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: coordination_node handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/coordination-tools.ts ' +
          '\'coordination_node\' handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
