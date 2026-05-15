// charter: dispatch
// Barrel for archivist hive-mind_* read/write handlers (ADR-0180 Phase 3/4).
// Importing this module triggers the side-effecting `registerReadHandler` /
// `registerMutationHandler` calls so the registry is populated before dispatch.

export * from './agents-json.js';
export * from './broadcast.js';
export * from './consensus.js';
export * from './memory.js';
export * from './shutdown.js';
export * from './spawn.js';
export * from './status.js';
