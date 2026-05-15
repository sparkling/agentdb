// charter: dispatch
// Barrel for archivist daa_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch.
//
// Read-only daa_* tools (`daa_learning_status`, `daa_performance_metrics`,
// and the `daa_cognitive_pattern action='analyze'` branch) are out of scope
// for this barrel — they route through `dispatchRead` when the read-split
// lands and will register under a sibling read barrel.

export * from './agent-create.js';
export * from './agent-adapt.js';
export * from './workflow-create.js';
export * from './workflow-execute.js';
export * from './knowledge-share.js';
export * from './cognitive-pattern.js';
