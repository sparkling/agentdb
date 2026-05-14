// charter: dispatch
// Barrel for archivist workflow_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch. workflow_status and
// workflow_list are read-only at the cli surface and migrate as
// `registerReadHandler<...>` in a sibling Phase 5 task — not exported here.

export * from './run';
export * from './create';
export * from './execute';
export * from './pause';
export * from './resume';
export * from './cancel';
export * from './delete';
export * from './template';
