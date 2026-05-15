// charter: dispatch
// Barrel for archivist claims_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch.

// IMPLEMENTED handlers
export * from './accept-handoff.js';
export * from './claim.js';
export * from './release.js';
export * from './handoff.js';
export * from './status.js';
export * from './mark-stealable.js';
export * from './steal.js';
export * from './rebalance.js';
