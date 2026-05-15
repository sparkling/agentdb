// charter: dispatch
// coordination_topology mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<CoordinationTopologyPayload>` so every topology
// transition (get / set / optimize) flows through the archivist's audit-chain
// (intent → applied | rejected) with guard verdicts + invariant verdicts recorded.
//
// Why mixed-mode actions register as ONE mutation handler (mirrors hive-mind/
// consensus.ts precedent):
//   - get:      reads `store.topology` and node aggregate. Pure read shape, but
//               flows through the mutation registration so there is exactly one
//               registry entry per cli tool name.
//   - set:      mutates `store.topology.{type,maxNodes,redundancy,consensusAlgorithm}`.
//   - optimize: derives recommended topology from `Object.keys(store.nodes).length`.
//               Pure read shape today; the dispatch boundary may short-circuit to
//               a read in a later phase.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/coordination-tools.ts`
// `coordination_topology` handler — load → action-switch → mutate →
// `saveCoordStore` (writeFileSync over `.claude-flow/coordination/store.json`).
// The cli callsite stays in place until the dispatch boundary is wired through
// cli (mirroring memory_store / hive-mind_consensus pending wire-up). This file
// establishes the registration shape the dispatch path will resolve.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/coordination/store.json` may mutate. Direct fs writes are
// forbidden by the `no-restricted-imports` backstop and the path-restricted
// substrate-internal.ts seam (ADR-0180 §Type enforcement). The underlying
// primitive is `makeFsJsonSubstrate` (substrates/fs-json-store.ts), shared with
// the other five `coordination_*` mutation handlers — all six route through the
// same FS-JSON store under one cross-process O_EXCL sentinel lock.

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

/** Topology type — matches the CLI inputSchema enum. */
export type TopologyType =
  | 'mesh'
  | 'hierarchical'
  | 'ring'
  | 'star'
  | 'hybrid'
  | 'hierarchical-mesh';

/** Consensus algorithm advertised on the topology record. Distinct from the
 *  per-proposal `coordination_consensus` strategy. */
export type TopologyConsensusAlgorithm = 'raft' | 'byzantine' | 'gossip' | 'crdt';

/** Action discriminator — mirrors the cli tool's inputSchema.action enum. */
export type CoordinationTopologyAction = 'get' | 'set' | 'optimize';

/**
 * Mutation payload mirroring the CLI tool's `coordination_topology` input shape
 * (coordination-tools.ts inputSchema lines 138-144). All fields optional except
 * `action`; `action` defaults to `'get'` at the wire-up callsite.
 */
export interface CoordinationTopologyPayload {
  readonly action?: CoordinationTopologyAction;
  readonly type?: TopologyType;
  readonly maxNodes?: number;
  readonly redundancy?: number;
  readonly consensusAlgorithm?: TopologyConsensusAlgorithm;
}

const STORE_ID = 'coordination_topology' as StoreId;

// Ports the action-switch body of coordination-tools.ts `coordination_topology`.
// The cli's `loadCoordStore → action-switch → saveCoordStore` (direct
// writeFileSync) collapses to a single `ctx.substrate.withWrite` because
// `makeFsJsonSubstrate` owns the lock semantics. `get` / `optimize` are
// read-shaped at the cli surface (no `saveCoordStore`) — they flow through the
// mutation registration so there is one registry entry per cli tool name, but
// only `set` writes.
export const topologyCoordinationHandler: GuardedWrite<CoordinationTopologyPayload> =
  registerMutationHandler<CoordinationTopologyPayload>(
    'coordination_topology',
    async (ctx: MutationContext<false>, payload: CoordinationTopologyPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<CoordinationStore>({
          storeId: STORE_ID,
          key: COORD_STORE_KEY,
        });
        const store: CoordinationStore = current ?? loadCoordStore();
        const action: CoordinationTopologyAction = payload.action ?? 'get';

        // `get` and `optimize` are pure reads in the cli — no write.
        if (action === 'get' || action === 'optimize') {
          return;
        }

        if (action === 'set') {
          if (payload.type !== undefined) store.topology.type = payload.type;
          if (payload.maxNodes !== undefined) store.topology.maxNodes = payload.maxNodes;
          if (payload.redundancy !== undefined) store.topology.redundancy = payload.redundancy;
          if (payload.consensusAlgorithm !== undefined) {
            store.topology.consensusAlgorithm = payload.consensusAlgorithm;
          }
          await handle.write({ storeId: STORE_ID, key: COORD_STORE_KEY, payload: store });
          return;
        }

        throw new Error(`coordination_topology: unknown action '${String(action)}'`);
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
