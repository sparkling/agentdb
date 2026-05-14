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

export * from './filtered-search';
export * from './pattern-search';
export * from './hierarchical-recall';
export * from './reflexion-retrieve';
export * from './skill-search';
export * from './route';
export * from './embed';
export * from './causal-recall';
export * from './neural-patterns';
export * from './semantic-route';
export * from './feedback';
export * from './pattern-store';
export * from './reflexion-store';
export * from './skill-create';
export * from './hierarchical-store';
export * from './sona-trajectory-store';
export * from './experience-record';
