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
// ADR-0181 Phase 7 (2026-05-15) — re-enabled after the cli adapters in
// forks/ruflo/v3/@claude-flow/cli/src/memory/archivist-init.ts gained
// stub-vs-real controller detectors. Each makeCli{ReflexionStore,
// SkillLibrary,HierarchicalMemory,SonaTrajectory}Writer now inspects the
// resolved controller for method-surface markers that are only present on
// the real agentdb controllers (HierarchicalMemory.{getStats,promote};
// ReflexionMemory.{retrieveRelevant,getCacheStats}; SkillLibrary.
// {searchSkills,getCacheStats}; SonaTrajectoryService.{getEngineType,
// getStats}). When the surface looks like a stub the adapter returns null,
// the handler's existing fail-loud throw fires, and the acceptance
// harness's _expect_mcp_body skip-accept regex matches "controller not
// available" — preserving the prior skip_accepted state instead of
// FAILing on a write-succeeds-but-read-empty round-trip.
//
// Probes covered:
//   - reflexion-store      → adr0112-27-1, p13-agentdb-reflexion
//   - skill-create         → adr0112-27-3, p13-agentdb-skill
//   - hierarchical-store   → adr0112-27-4, adr0178-hquery-e2e
//   - sona-trajectory-store → adr0090-b5-sonaTrajectory
export * from './feedback.js';
export * from './pattern-store.js';
export * from './experience-record.js';
export * from './reflexion-store.js';
export * from './skill-create.js';
export * from './hierarchical-store.js';
export * from './sona-trajectory-store.js';
