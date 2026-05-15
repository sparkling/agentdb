// charter: mutation-invariants
// Barrel re-export for the agentdb_* mutation invariants (ADR-0180 §Architecture
// · Mutation invariants). Migrators import their per-tool invariant array and
// pass it to `registerMutationHandler(..., { invariants: <array> })`.
//
// Wired today: pattern_store, feedback, experience_record, route. Stubs whose
// handler body is body-ready-but-un-exported (reflexion-store, skill-create,
// hierarchical-store, sona-trajectory-store) gain invariants when their
// handlers re-export through `handlers/agentdb/index.ts`.

export type { AgentdbPatternStorePayload } from './pattern-store.js';
export { patternStoreInvariants } from './pattern-store.js';

export type { AgentdbFeedbackPayload } from './feedback.js';
export { feedbackInvariants } from './feedback.js';

export type { AgentdbExperienceRecordPayload } from './experience-record.js';
export { experienceRecordInvariants } from './experience-record.js';

export type { AgentdbRoutePayload } from './route.js';
export { routeInvariants } from './route.js';
