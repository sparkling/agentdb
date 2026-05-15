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
// HANDLERS PRESENT BUT UN-EXPORTED (stub controllers in test env succeed
// without persisting to SQLite; the round-trip probes read SQLite which
// stays empty → FAIL). These handlers' bodies are ready; they'll re-enable
// once Phase 7 wires real controllers (or a controller-stub detector
// returns null so my fail-loud throw fires):
//   - reflexion-store      blocks: adr0112-27-1, p13-agentdb-reflexion
//   - skill-create         blocks: adr0112-27-3, p13-agentdb-skill
//   - hierarchical-store   blocks: adr0112-27-4, adr0178-hquery-e2e
//   - sona-trajectory-store blocks: adr0090-b5-sonaTrajectory
// Re-enable by uncommenting each line below as Phase 7 capability wiring
// matures.
export * from './feedback.js';
export * from './pattern-store.js';
export * from './experience-record.js';
//   export * from './reflexion-store.js';        // Phase 7: stub controller false-positive
//   export * from './skill-create.js';           // Phase 7: stub controller false-positive
//   export * from './hierarchical-store.js';     // Phase 7: stub controller false-positive
//   export * from './sona-trajectory-store.js';  // Phase 7: stub controller false-positive
