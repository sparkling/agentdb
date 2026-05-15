// charter: dispatch
// Barrel for archivist workflow_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch. workflow_status and
// workflow_list are read-only at the cli surface and migrate as
// `registerReadHandler<...>` in a sibling Phase 5 task — not exported here.

export * from './run.js';
export * from './create.js';
export * from './execute.js';
export * from './pause.js';
export * from './resume.js';
export * from './cancel.js';
export * from './delete.js';
export * from './template.js';
