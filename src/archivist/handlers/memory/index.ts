// charter: dispatch
// Barrel for archivist memory_* read/write handlers (ADR-0180 Phase 3).
// Importing this module triggers the side-effecting `registerReadHandler` /
// `registerMutationHandler` calls so the registry is populated before dispatch.

export * from './search.js';
export * from './search-unified.js';
export * from './store.js';
export * from './retrieve.js';
export * from './list.js';
export * from './bridge-status.js';
