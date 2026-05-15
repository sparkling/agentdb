// charter: dispatch
// Barrel for archivist hive-mind_* read/write handlers (ADR-0180 Phase 3/4).
// Importing this module triggers the side-effecting `registerReadHandler` /
// `registerMutationHandler` calls so the registry is populated before dispatch.

// IMPLEMENTED handlers
export * from './agents-json.js';
export * from './broadcast.js';
export * from './init.js';
export * from './memory.js';
export * from './shutdown.js';
export * from './spawn.js';
// ADR-0181 Phase 6 r4 wire-up — substrate-only projection of hive-state
// health. Cli `hive-mind_status` keeps its rich orchestration today (see
// hive-mind-tools.ts:1761 Phase 6+ deferral comment); this body is
// governance-shape coverage so dispatch resolves a useful slice instead of
// throwing when the cli eventually flips.
export * from './status.js';

// STUB handlers — pending Phase N wire-up; dispatch surfaces
// `tool not registered` → acceptance skip-accepted.
// consensus.ts: 1000+ lines of strategy-specific orchestration (BFT/Raft/
// Quorum/Weighted/Gossip/CRDT) with cross-strategy resolution + ADR-0131
// auto-status-transition + ADR-0121 CRDT merge — too entangled for a
// single-handler port. Cli explicitly defers (hive-mind-tools.ts:1995).
// Phase 6+ split into per-strategy handlers is the canonical path.
//   export * from './consensus.js';
