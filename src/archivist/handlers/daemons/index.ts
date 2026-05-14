// charter: dispatch
// Barrel for archivist daemon_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch.
//
// Scope: daemon-scheduled worker writes from
// `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts`. Under
// ADR-0180 F4-3 the daemon callsites remain in place; only the registration
// shapes land here. Sibling worker types (audit, optimize, consolidate, ...)
// register here as their Phase 5 wire-ups land.

export * from './map';
export * from './audit';
export * from './optimize';
export * from './testgaps';
export * from './consolidate';
export * from './benchmark';
export * from './auto-memory-bridge';
export * from './hooks-learning';
