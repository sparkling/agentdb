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

// STUB handlers — bodies throw `pending Phase N wire-up`. Registering them
// would surface that throw at cli dispatch sites that flipped in Phase 5,
// breaking acceptance checks. Excluded from registration; cli dispatch will
// see `archivist: tool not registered '<name>'` which the acceptance
// harness's `_expect_mcp_body` skip-accept whitelist matches (ADR-0082
// narrow). Re-add each line below as the corresponding handler body lands
// (Phase 6+):
//   export * from './feedback.js';                // TODO Phase 3 wire-up
//   export * from './pattern-store.js';           // TODO Phase 3 wire-up
//   export * from './reflexion-store.js';         // TODO Phase 3 wire-up
//   export * from './skill-create.js';            // TODO Phase 3 wire-up
//   export * from './hierarchical-store.js';      // TODO Phase 3 wire-up
//   export * from './sona-trajectory-store.js';   // TODO Phase 3 wire-up
//   export * from './experience-record.js';       // TODO Phase 3 wire-up
