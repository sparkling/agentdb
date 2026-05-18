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

// ADR-0184 Wave 1: per-strategy split landed. consensus.ts is the parent
// dispatcher (per-strategy bodies live under handlers/hive-mind/consensus/
// <strategy>.ts). All six strategies still throw `pending` in Wave 1; cli
// `hive-mind_consensus` (hive-mind-tools.ts:~1984-2910) remains load-bearing
// until Wave 6 retirement.
export * from './consensus.js';
