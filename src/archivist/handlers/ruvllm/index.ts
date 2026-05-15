// charter: dispatch
// Barrel for archivist ruvllm_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch.

export * from './hnsw-create.js';
export * from './hnsw-add.js';
export * from './sona-create.js';
export * from './sona-adapt.js';
export * from './microlora-create.js';
export * from './microlora-adapt.js';
