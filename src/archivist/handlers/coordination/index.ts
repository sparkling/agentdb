// charter: dispatch
// Barrel for archivist coordination_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch.
//
// Scope: only the SIX mutating cli tools register here. `coordination_metrics`
// is purely read-only in the cli (no `saveCoordStore` callsite) and therefore
// has no mutation handler. If it later gains a read-handler (Phase 6+) it
// should land under this same directory and be re-exported below.

export * from './topology';
export * from './load-balance';
export * from './sync';
export * from './node';
export * from './consensus';
export * from './orchestrate';
