// charter: mutation-invariants
// Barrel re-export for hive-mind_* invariants (ADR-0181 §H + ADR-0184).
// Per-strategy consensus invariants live under `./consensus/<strategy>.ts`
// and are barrel-exported via `./consensus/index.ts`; the parent handler
// (handlers/hive-mind/consensus.ts) spreads them at registration. Wave 1
// arrays are all empty; wave-N ports grow each array independently.

export type { AgentsJsonPayload } from './agents-json.js';
export { agentsJsonInvariants } from './agents-json.js';

export {
  bftConsensusInvariants,
  raftConsensusInvariants,
  quorumConsensusInvariants,
  weightedConsensusInvariants,
  gossipConsensusInvariants,
  crdtConsensusInvariants,
} from './consensus/index.js';

export type { HiveMindBroadcastPayload } from './broadcast.js';
export { broadcastInvariants } from './broadcast.js';

export type { HiveMindInitPayload } from './init.js';
export { initInvariants } from './init.js';

export type { HiveMindMemoryPayload } from './memory.js';
export { memoryInvariants } from './memory.js';

export type { HiveMindShutdownPayload } from './shutdown.js';
export { shutdownInvariants } from './shutdown.js';

export type { HiveMindSpawnPayload } from './spawn.js';
export { spawnInvariants as hiveMindSpawnInvariants } from './spawn.js';

export type { HiveMindStatusQuery } from './status.js';
export { statusInvariants as hiveMindStatusInvariants } from './status.js';
