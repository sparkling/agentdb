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
import {
  COORD_STORE_KEY,
  loadCoordStore,
  type CoordinationStore,
} from './shared.js';

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

// Ports the action-switch body of coordination-tools.ts `coordination_node`.
// `list` / `status` / `info` are pure reads in the cli; `add` / `remove` /
// `heartbeat` mutate `store.nodes`. The cli's `loadCoordStore → action-switch →
// saveCoordStore` collapses to one `ctx.substrate.withWrite`.
//
// Divergence from the cli (`feedback-no-fallbacks`): the cli's `heartbeat`
// silently no-ops for an unknown `nodeId` yet still returns `{success: true}`.
// That masks a caller bug (heartbeating a node that was never added). This
// handler instead throws — same fail-loud treatment `remove` already gives an
// unknown nodeId.
export const nodeCoordinationHandler: GuardedWrite<CoordinationNodePayload> =
  registerMutationHandler<CoordinationNodePayload>(
    'coordination_node',
    async (ctx: MutationContext<false>, payload: CoordinationNodePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<CoordinationStore>({
          storeId: STORE_ID,
          key: COORD_STORE_KEY,
        });
        const store: CoordinationStore = current ?? loadCoordStore();
        const action: CoordinationNodeAction = payload.action ?? 'list';

        if (action === 'list' || action === 'status' || action === 'info') {
          return;
        }

        if (action === 'add') {
          const nodeId = payload.nodeId ?? `node-${Date.now()}`;
          store.nodes[nodeId] = {
            id: nodeId,
            status: 'active',
            load: 0,
            lastHeartbeat: new Date().toISOString(),
          };
          await handle.write({ storeId: STORE_ID, key: COORD_STORE_KEY, payload: store });
          return;
        }

        if (action === 'remove') {
          const nodeId = payload.nodeId;
          if (nodeId === undefined || !store.nodes[nodeId]) {
            throw new Error(
              `coordination_node: cannot remove node '${String(nodeId)}' — not found`,
            );
          }
          delete store.nodes[nodeId];
          await handle.write({ storeId: STORE_ID, key: COORD_STORE_KEY, payload: store });
          return;
        }

        if (action === 'heartbeat') {
          const nodeId = payload.nodeId;
          if (nodeId === undefined || !store.nodes[nodeId]) {
            throw new Error(
              `coordination_node: cannot heartbeat node '${String(nodeId)}' — not found`,
            );
          }
          store.nodes[nodeId].lastHeartbeat = new Date().toISOString();
          store.nodes[nodeId].status = 'active';
          await handle.write({ storeId: STORE_ID, key: COORD_STORE_KEY, payload: store });
          return;
        }

        throw new Error(`coordination_node: unknown action '${String(action)}'`);
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
