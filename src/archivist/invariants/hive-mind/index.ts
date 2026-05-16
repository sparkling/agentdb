// charter: mutation-invariants
// Barrel re-export for hive-mind_* invariants (ADR-0181 §H).
// consensus.ts handler is deferred (per-strategy split — handover §B);
// invariants will land alongside the eventual per-strategy handlers.

export type { AgentsJsonPayload } from './agents-json.js';
export { agentsJsonInvariants } from './agents-json.js';

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
