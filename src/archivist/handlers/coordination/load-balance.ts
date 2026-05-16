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

import { registerMutationHandler } from '../../registration.js';
import type { MutationContext } from '../../mutation-context.js';
import type { GuardedWrite, StoreId } from '../../types.js';
import { loadBalanceInvariants } from '../../invariants/coordination/load-balance.js';
import {
  COORD_STORE_KEY,
  loadCoordStore,
  type CoordinationStore,
  type CoordNode,
} from './shared.js';

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

// Ports the action-switch body of coordination-tools.ts
// `coordination_load_balance`. `get` is a pure read in the cli; `set` mutates
// `loadBalance.{algorithm,weights}`; `distribute` mutates `nodes[selected].load`
// (a counter increment, not a config mutation). The cli's `loadCoordStore →
// action-switch → saveCoordStore` collapses to one `ctx.substrate.withWrite`.
export const loadBalanceCoordinationHandler: GuardedWrite<CoordinationLoadBalancePayload> =
  registerMutationHandler<CoordinationLoadBalancePayload>(
    'coordination_load_balance',
    async (ctx: MutationContext<false>, payload: CoordinationLoadBalancePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<CoordinationStore>({
          storeId: STORE_ID,
          key: COORD_STORE_KEY,
        });
        const store: CoordinationStore = current ?? loadCoordStore();
        const action: CoordinationLoadBalanceAction = payload.action ?? 'get';

        if (action === 'get') {
          return;
        }

        if (action === 'set') {
          if (payload.algorithm !== undefined) store.loadBalance.algorithm = payload.algorithm;
          if (payload.weights !== undefined) {
            store.loadBalance.weights = { ...payload.weights };
          }
          await handle.write({ storeId: STORE_ID, key: COORD_STORE_KEY, payload: store });
          return;
        }

        if (action === 'distribute') {
          const nodes = Object.values(store.nodes).filter((n) => n.status === 'active');
          if (nodes.length === 0) {
            throw new Error('coordination_load_balance: no active nodes available to distribute to');
          }

          let selectedNode: CoordNode;
          const algorithm = store.loadBalance.algorithm;
          if (algorithm === 'least-connections' || algorithm === 'adaptive') {
            selectedNode = nodes.reduce((min, n) => (n.load < min.load ? n : min));
          } else if (algorithm === 'weighted') {
            const weights = store.loadBalance.weights;
            selectedNode = nodes.reduce((max, n) =>
              (weights[n.id] ?? 1) > (weights[max.id] ?? 1) ? n : max,
            );
          } else {
            selectedNode = nodes[0];
          }

          selectedNode.load += 1;
          await handle.write({ storeId: STORE_ID, key: COORD_STORE_KEY, payload: store });
          return;
        }

        throw new Error(`coordination_load_balance: unknown action '${String(action)}'`);
      });
    },
    {
      invariants: loadBalanceInvariants,
      cacheScope: 'global',
    },
  );
