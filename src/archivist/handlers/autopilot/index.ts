// charter: dispatch
// Barrel for archivist autopilot_* mutation handlers (ADR-0180 Phase 5 wave 2).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch.
//
// Scope: only the FIVE mutating cli tools register here (verified via
// handler-body inspection per Phase 5 wave-2 brief):
//   - autopilot_enable    (saveState + appendLog)
//   - autopilot_disable   (saveState + appendLog)
//   - autopilot_config    (saveState)
//   - autopilot_reset     (saveState + appendLog)
//   - autopilot_learn     (AutopilotLearning side-effects on AgentDB)
//
// Reads (NOT registered as mutation handlers — pure read shape verified at
// autopilot-tools.ts):
//   - autopilot_status    (loadState + discoverTasks only)
//   - autopilot_history   (loadLog only; recallSimilarTasks is read-only)
//   - autopilot_progress  (loadState + discoverTasks only)
//   - autopilot_predict   (loadState + predictNextAction read-only)
//   - autopilot_log       (loadLog + slice only — DISAGREEMENT WITH BRIEF:
//                         the wave-2 brief listed `autopilot_log` as a
//                         mutator, but handler-body inspection at
//                         autopilot-tools.ts:163-167 shows ONLY `loadLog()`
//                         + `slice(-last)` — no saveState, no appendLog. Per
//                         the brief's own rule "exclude any 'mutators' that
//                         turn out to be reads", autopilot_log is excluded
//                         here. If a later phase gains a read-handler path,
//                         it should land under a sibling directory and be
//                         re-exported.)

export * from './enable.js';
export * from './disable.js';
export * from './config.js';
export * from './reset.js';
export * from './learn.js';
