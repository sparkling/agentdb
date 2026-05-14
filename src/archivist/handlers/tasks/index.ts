// charter: dispatch
// Barrel for archivist task_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch.

export * from './create';
export * from './status';
export * from './list';
export * from './complete';
export * from './update';
export * from './assign';
export * from './cancel';
