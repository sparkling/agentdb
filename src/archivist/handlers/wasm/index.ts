// charter: dispatch
// Barrel for archivist wasm_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch.

export * from './create.js';
export * from './prompt.js';
export * from './tool.js';
export * from './terminate.js';
export * from './gallery-create.js';
