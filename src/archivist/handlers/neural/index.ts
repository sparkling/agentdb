// charter: dispatch
// Barrel for archivist neural_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch.

export * from './train';
export * from './compress';
export * from './optimize';
export * from './patterns';
