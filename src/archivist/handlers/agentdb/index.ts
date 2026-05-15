// charter: dispatch
// Barrel for archivist agentdb_* read/write handlers (ADR-0180 Phase 6).
// Importing this module triggers the side-effecting `registerReadHandler` /
// `registerMutationHandler` calls so the registry is populated before dispatch.
//
// Scope: agentdb_* cli surface migration (~20 tools per ADR-0180 §Caller
// surfaces). Includes the 8 ranked-read tools (filtered_search,
// pattern_search, reflexion_retrieve, skill_search, causal_recall,
// hierarchical_recall, neural_patterns, semantic_route) plus the mutation
// archetypes per ADR-0180 §Provenance rollout scope (route/store/embed/
// feedback) and the store-class mutation tools (pattern_store,
// reflexion_store, skill_create, hierarchical_store, sona_trajectory_store,
// experience_record).

// IMPLEMENTED handlers — exported for side-effecting registry population.
export * from './filtered-search.js';
export * from './pattern-search.js';
export * from './hierarchical-recall.js';
export * from './reflexion-retrieve.js';
export * from './skill-search.js';
export * from './route.js';
export * from './embed.js';
export * from './causal-recall.js';
export * from './neural-patterns.js';
export * from './semantic-route.js';

// ADR-0181 Phase 6 wire-up — bodies port to call narrow writer capabilities
// (ReasoningBankWriter / SkillLibraryWriter / etc.) with substrate.withWrite
// audit-chain. Each handler honours ADR-0082 no-silent-failure: explicit
// controller errors propagate as throws.
//
// EXPORTED (controller wired in test env OR no read-side dependency):
//   - pattern-store: ReasoningBank routes through routePatternOp which has
//     its own memory-router fallback that pattern-search ALSO reads from
//     (RVF). Round-trip works regardless of controller-wire state.
//   - feedback: no acceptance probe; audit-trail surface so RVF fallback
//     is the goal.
//   - experience-record: no round-trip probe blocks on it (only b5-learningSystem
//     which has independent skip patterns).
//
// ADR-0181 Phase 7 (2026-05-15) — wire-up landing.
//
// The four agentdb_*_store handlers below were previously gated off because
// the controllers "existed" (the detector found marker methods) but the
// SQLite tables their matching read handlers query stayed empty after a
// successful write — the persistence path was unwired. Phase 7 (a) routes
// the three controller-backed write storeIds (reflexion / skill /
// hierarchical) into the SQLite carve-out alongside the existing read
// storeIds (substrate-registry.ts), (b) repoints the cli-side
// ensureSqliteWired path to the same `.swarm/memory.db` AgentDB's `memory
// init` provisions, and (c) ports agentdb_hierarchical_recall to a
// SQL-over-hierarchical_memory read so the read↔write pair shares the
// same substrate family.
//
// Sona stays deferred: SonaTrajectoryService is in-memory-only by design
// (no SQLite persistence) and there is no sibling read handler registered
// yet — see the per-line note below.
export * from './feedback.js';
export * from './pattern-store.js';
export * from './experience-record.js';
export * from './reflexion-store.js';
export * from './skill-create.js';
export * from './hierarchical-store.js';
// export * from './sona-trajectory-store.js';  // DEFERRED Phase 7+: SonaTrajectoryService is in-memory-only by design (no SQLite persistence + no sibling read handler). Follow-up ADR required for SQLite migration + read handler registration.
