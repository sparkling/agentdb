// charter: mutation-invariants
// Barrel for per-strategy hive-mind_consensus invariants (ADR-0184).
// Wave 1: all per-strategy arrays are empty (`[]`); wave-N ports grow each
// array independently. Parent handler (handlers/hive-mind/consensus.ts)
// concatenates these at registration via spread.

export { bftConsensusInvariants } from './bft.js';
export { raftConsensusInvariants } from './raft.js';
export { quorumConsensusInvariants } from './quorum.js';
export { weightedConsensusInvariants } from './weighted.js';
export { gossipConsensusInvariants } from './gossip.js';
export { crdtConsensusInvariants } from './crdt.js';
