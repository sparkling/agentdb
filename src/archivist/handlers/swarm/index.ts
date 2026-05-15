// charter: dispatch
// Barrel for archivist swarm_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch.
//
// Scope: mutating swarm_* tools only (swarm_init, swarm_shutdown). Read-shaped
// surfaces (swarm_status, swarm_health, swarm_exists) land in Phase 7 §Read
// surface migration with `registerReadHandler` semantics.

export * from './init.js';
export * from './shutdown.js';
