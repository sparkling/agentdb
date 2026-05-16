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
// ADR-0181 Item 2 (2026-05-15): GNNService telemetry split out from
// agentdb_neural_patterns into its own dispatched handler — every action of
// the legacy cli tool now goes through dispatch (no per-action bypass).
export * from './gnn-stats.js';
// ADR-0181 Item 3 (2026-05-16): CausalMemoryGraph writer — audit-trail
// dispatch wrap around the existing cli `recordCausalEdge` /
// `routeCausalOp` path. Today's writer falls through to RVF via the
// router-fallback because `CausalMemoryGraph.addCausalEdge` requires a
// numeric memoryId mapping that ADR-0147 R7 has not delivered yet;
// substrate-registry already classifies the storeId as SQLite carve-out so
// a future R7 collapse can land without re-routing. See the handler header
// for the full audit-vs-storage rationale.
export * from './causal-edge.js';

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
// Sona is NOT a deferred wiring decision — it joins the permanently-cli-only
// bucket alongside hooks/* and session_* (handover Section J). The capability
// surface and handler body are wired and work; what's missing is a
// controller-level behavioural change (the service is pure-compute by design)
// plus a sibling read handler. See the per-line note below for the full
// rationale.
export * from './feedback.js';
export * from './pattern-store.js';
export * from './experience-record.js';
export * from './reflexion-store.js';
export * from './skill-create.js';
export * from './hierarchical-store.js';
// ADR-0181 Item 6 (2026-05-16) — sona-trajectory-store now exports BOTH a
// mutation handler (record action) AND a sibling read handler (stats
// action). SonaTrajectoryService gained an optional `{ getDb }` lazy SQLite
// resolver in its constructor (services/SonaTrajectoryService.ts) — the cli's
// controller-registry passes `this.agentdb.database` so recordTrajectory
// dual-writes to a `sona_trajectories` SQLite table alongside the in-memory
// Map. getStats / getPatterns merge the two. RL training state stays
// in-memory; predict() quality unchanged. The cli wrapper at
// agentdb-tools.ts splits action='record' through dispatch and
// action='stats' through dispatchRead. substrate-registry classification
// moved RVF→SQLite carve-out to match the now-SQLite persistence model.
// Removed from handover Section J's permanently-cli-only bucket — Item 6
// is the follow-up ADR that section anticipated.
export * from './sona-trajectory-store.js';
