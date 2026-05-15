// charter: dispatch
// Barrel for archivist github_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch.
//
// Note: `github_metrics` is intentionally absent — that cli tool is read-only
// (git rev-list / gh release list / gh issue list aggregation, no fork-side
// writes to `.claude-flow/github/store.json`) and so does not require a
// mutation handler. Per ADR-0180 §Audit chain, reads are passthroughs.

export * from './repo-analyze.js';
export * from './pr-manage.js';
export * from './issue-track.js';
export * from './workflow.js';
