// charter: dispatch
// Barrel for archivist memory_* read/write handlers (ADR-0180 Phase 3).
// Importing this module triggers the side-effecting `registerReadHandler` /
// `registerMutationHandler` calls so the registry is populated before dispatch.

// IMPLEMENTED handlers (read handlers — Phase 3 PASS)
export * from './search.js';
export * from './search-unified.js';
export * from './retrieve.js';
export * from './list.js';
export * from './bridge-status.js';

// STUB — body pending Phase 3 wire-up.
//   export * from './store.js';
