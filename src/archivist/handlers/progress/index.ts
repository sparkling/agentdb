// charter: dispatch
// Barrel for archivist progress_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch. Only mutating progress_*
// tools land here — `progress_check`, `progress_summary`, `progress_watch`
// remain read-only on the cli surface (progress-tools.ts) and do not require
// archivist registration.

export * from './sync';
