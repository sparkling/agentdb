// charter: dispatch
// Barrel for archivist memory_* read/write handlers (ADR-0180 Phase 3).
// Importing this module triggers the side-effecting `registerReadHandler` /
// `registerMutationHandler` calls so the registry is populated before dispatch.

export * from './search';
export * from './search-unified';
export * from './store';
export * from './retrieve';
export * from './list';
export * from './bridge-status';
