// charter: dispatch
// Barrel for archivist config_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch.

export * from './set.js';
export * from './reset.js';
export * from './import.js';
