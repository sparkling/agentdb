// charter: dispatch
// Barrel for archivist performance_* mutation handlers (ADR-0180 Phase 5).
// Importing this module triggers the side-effecting `registerMutationHandler`
// calls so the registry is populated before dispatch. Only mutating
// performance_* tools land here:
//
//   - performance_report     → ./report.ts (rolling metrics.json, 100-sample roll-off)
//   - performance_benchmark  → ./benchmark.ts (overwrite-not-append volatile namespace,
//                              ADR-0180 Open Follow-up #14 Site 2 fix)
//
// performance_metrics is read-only on the cli surface (performance-tools.ts:
// 408-520 calls `loadPerfStore` only; the cli's `savePerfStore` path is not
// triggered) and does not require mutation-handler registration. The
// performance_bottleneck / performance_profile / performance_optimize cli
// handlers are stubs (`_stub: true` placeholder returns, no fs writes) and
// likewise do not register here.

export * from './report';
export * from './benchmark';
