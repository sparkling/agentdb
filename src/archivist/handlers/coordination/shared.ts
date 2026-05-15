// charter: dispatch
// Shared store shape + default-store factory for the six archivist
// coordination_* mutation handlers (ADR-0180 Phase 5 / ADR-0181 Phase 2).
//
// Mirrors `CoordinationStore` from cli/src/mcp-tools/coordination-tools.ts. The
// cli's `loadCoordStore()` returns this default when `.claude-flow/coordination/
// store.json` is absent; the archivist handlers read the substrate first and
// fall back to this same default so an un-initialised store behaves identically
// to the cli path. `orchestrations` is folded into the canonical shape here so
// `coordination_orchestrate` no longer needs the cli's `CoordStoreShape` cast.

export interface TopologyConfig {
  type: 'mesh' | 'hierarchical' | 'ring' | 'star' | 'hybrid' | 'hierarchical-mesh';
  maxNodes: number;
  redundancy: number;
  consensusAlgorithm: string;
}

export interface LoadBalanceConfig {
  algorithm: 'round-robin' | 'least-connections' | 'weighted' | 'adaptive';
  weights: Record<string, number>;
  healthCheck: boolean;
}

export interface SyncState {
  lastSync: string;
  syncCount: number;
  conflicts: number;
  pendingChanges: number;
}

export interface CoordNode {
  id: string;
  status: string;
  load: number;
  lastHeartbeat: string;
}

export interface CoordConsensusProposal {
  proposalId: string;
  type: string;
  proposal: unknown;
  proposedBy: string;
  proposedAt: string;
  votes: Record<string, boolean>;
  status: string;
  strategy: string;
  term?: number;
  quorumPreset?: string;
  byzantineVoters?: string[];
}

export interface CoordConsensusResult {
  proposalId: string;
  result: string;
  votes: { for: number; against: number };
  decidedAt: string;
  strategy: string;
  term?: number;
  byzantineDetected?: string[];
}

export interface CoordConsensusState {
  pending: CoordConsensusProposal[];
  history: CoordConsensusResult[];
}

export interface CoordOrchestration {
  id: string;
  task: string;
  strategy: string;
  agents: ReadonlyArray<string>;
  status: 'scheduled';
  scheduledAt: string;
  topology: string;
}

export interface CoordinationStore {
  topology: TopologyConfig;
  loadBalance: LoadBalanceConfig;
  sync: SyncState;
  nodes: Record<string, CoordNode>;
  version: string;
  consensus?: CoordConsensusState;
  orchestrations?: CoordOrchestration[];
}

/** Key for the single canonical record inside each coordination_* store. */
export const COORD_STORE_KEY = 'root';

/** Default store — mirrors `loadCoordStore()`'s default branch in the cli. */
export function loadCoordStore(): CoordinationStore {
  return {
    topology: {
      type: 'hierarchical',
      maxNodes: 15,
      redundancy: 2,
      consensusAlgorithm: 'raft',
    },
    loadBalance: {
      algorithm: 'adaptive',
      weights: {},
      healthCheck: true,
    },
    sync: {
      lastSync: new Date().toISOString(),
      syncCount: 0,
      conflicts: 0,
      pendingChanges: 0,
    },
    nodes: {},
    version: '3.0.0',
  };
}

/** Required-vote count for a consensus strategy — ports the cli's `calcRequired`. */
export function calcRequiredVotes(
  strategy: string,
  total: number,
  preset?: string,
): number {
  if (total <= 0) return 1;
  if (strategy === 'bft') return Math.floor((total * 2) / 3) + 1;
  if (strategy === 'quorum') {
    if (preset === 'unanimous') return total;
    if (preset === 'supermajority') return Math.floor((total * 2) / 3) + 1;
  }
  return Math.floor(total / 2) + 1;
}
