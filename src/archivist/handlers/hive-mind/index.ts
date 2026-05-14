// charter: dispatch
// Barrel for archivist hive-mind_* read/write handlers (ADR-0180 Phase 3/4).
// Importing this module triggers the side-effecting `registerReadHandler` /
// `registerMutationHandler` calls so the registry is populated before dispatch.

export * from './agents-json';
export * from './broadcast';
export * from './consensus';
export * from './memory';
export * from './shutdown';
export * from './spawn';
export * from './status';
