// charter: dispatch
// Barrel for archivist system_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch.
//
// Scope: only the THREE mutating cli tools register here. The remaining tools
// in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/system-tools.ts` are
// read-only and therefore have no mutation handler:
//   - `system_status` — `loadMetrics` only, no save (system-tools.ts:104-135)
//   - `system_info` — pure process-info read (system-tools.ts:422-445)
//   - `mcp_status` — process / network read (system-tools.ts:497-547)
//   - `task_summary` — task-store read (system-tools.ts:556-577)
// If any later gains a read-handler (Phase 6+) it should land under this same
// directory and be re-exported below.

export * from './metrics';
export * from './health';
export * from './reset';
