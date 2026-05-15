// charter: dispatch
// Barrel for archivist agent_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agent-tools.ts`
// — the cli callsites stay in place until the dispatch boundary is wired
// through cli (mirroring memory_store, hive-mind_spawn pending wire-up).
// All mutating tools (`agent_spawn`, `agent_execute`, `agent_terminate`,
// `agent_pool`, `agent_update`) target the same FS-JSON store at
// `.claude-flow/agents/store.json` via `makeFsJsonSubstrate`.
//
// Read-only tools (`agent_status`, `agent_list`, `agent_health`) live as
// read handlers in a sibling module per ADR-0180 §Audit chain — reads are
// passthroughs (no audit ceremony).

export * from './spawn.js';
export * from './terminate.js';
export * from './update.js';
export * from './execute.js';
export * from './pool.js';
