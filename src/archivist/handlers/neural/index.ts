// charter: dispatch
// Barrel for archivist neural_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch.

export * from './train.js';
export * from './compress.js';
export * from './optimize.js';
export * from './patterns.js';
