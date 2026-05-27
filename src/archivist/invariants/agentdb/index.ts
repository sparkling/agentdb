// charter: mutation-invariants
// Barrel re-export for the agentdb_* invariants (ADR-0180 §Architecture
// · Mutation invariants + ADR-0181 §H).
//
// Mutation invariants are passed to `registerMutationHandler(..., { invariants
// : <array> })` at handler registration. Read invariants (causal-recall,
// embed, filtered-search, gnn-stats, hierarchical-recall, neural-patterns,
// pattern-search, reflexion-retrieve, semantic-route, skill-search) ship as
// the contract spec — `RegisterReadOpts` does NOT accept invariants today
// (registration.ts L46-48); they wire at handler registration once the
// ADR-0180 §Read-path return-shape design lands.

// Mutations.
export type { AgentdbPatternStorePayload } from './pattern-store.js';
export { patternStoreInvariants } from './pattern-store.js';

export type { AgentdbFeedbackPayload } from './feedback.js';
export { feedbackInvariants } from './feedback.js';

export type { AgentdbExperienceRecordPayload } from './experience-record.js';
export { experienceRecordInvariants } from './experience-record.js';

export type { AgentdbRoutePayload } from './route.js';
export { routeInvariants } from './route.js';

export type { AgentdbCausalEdgePayload } from './causal-edge.js';
export { causalEdgeInvariants } from './causal-edge.js';

export type { AgentdbGraphEdgePayload } from './graph-edge.js';
export { graphEdgeInvariants } from './graph-edge.js';

export type { AgentdbHierarchicalStorePayload } from './hierarchical-store.js';
export { hierarchicalStoreInvariants } from './hierarchical-store.js';

export type { AgentdbReflexionStorePayload } from './reflexion-store.js';
export { reflexionStoreInvariants } from './reflexion-store.js';

export type { AgentdbSkillCreatePayload } from './skill-create.js';
export { skillCreateInvariants } from './skill-create.js';

export type { AgentdbSonaTrajectoryStorePayload } from './sona-trajectory-store.js';
export { sonaTrajectoryStoreInvariants } from './sona-trajectory-store.js';

// Read-handler invariants (contract spec — not wired into RegisterReadOpts today).
export type { AgentdbCausalRecallQuery } from './causal-recall.js';
export { causalRecallInvariants } from './causal-recall.js';

export type { AgentdbEmbedQuery } from './embed.js';
export { embedInvariants } from './embed.js';

export type { AgentdbFilteredSearchQuery } from './filtered-search.js';
export { filteredSearchInvariants } from './filtered-search.js';

export type { AgentdbGnnStatsQuery } from './gnn-stats.js';
export { gnnStatsInvariants } from './gnn-stats.js';

export type { AgentdbHierarchicalRecallQuery } from './hierarchical-recall.js';
export { hierarchicalRecallInvariants } from './hierarchical-recall.js';

export type { AgentdbNeuralPatternsQuery } from './neural-patterns.js';
export { neuralPatternsInvariants } from './neural-patterns.js';

export type { AgentdbPatternSearchQuery } from './pattern-search.js';
export { patternSearchInvariants } from './pattern-search.js';

export type { AgentdbReflexionRetrieveQuery } from './reflexion-retrieve.js';
export { reflexionRetrieveInvariants } from './reflexion-retrieve.js';

export type { AgentdbSemanticRouteQuery } from './semantic-route.js';
export { semanticRouteInvariants } from './semantic-route.js';

export type { AgentdbSkillSearchQuery } from './skill-search.js';
export { skillSearchInvariants } from './skill-search.js';
