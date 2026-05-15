// charter: dispatch
// Barrel for archivist task_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch.

export * from './create.js';
export * from './status.js';
export * from './list.js';
export * from './complete.js';
export * from './update.js';
export * from './assign.js';
export * from './cancel.js';
