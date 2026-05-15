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

// ADR-0181 Phase 6 wire-up — bodies now port to call narrow writer
// capabilities (ReasoningBankWriter / SkillLibraryWriter / ReflexionStoreWriter /
// HierarchicalMemoryWriter / LearningSystemWriter / SonaTrajectoryWriter /
// FeedbackRecorder) with RVF substrate.withWrite fallback when the underlying
// cli controller is unwired. Each handler honours ADR-0082 no-silent-failure:
// explicit controller errors (success:false + error not matching
// unwired-pattern regex) throw rather than silently coalesce.
export * from './feedback.js';
export * from './pattern-store.js';
export * from './reflexion-store.js';
export * from './skill-create.js';
export * from './hierarchical-store.js';
export * from './sona-trajectory-store.js';
export * from './experience-record.js';
