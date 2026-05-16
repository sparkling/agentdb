// charter: mutation-invariants
// Barrel re-export for the performance_* mutation invariants (ADR-0180 Phase 5 + ADR-0181 §H).

export type { PerfBenchmarkPayload } from './benchmark.js';
export { benchmarkInvariants } from './benchmark.js';

export type { PerfReportPayload } from './report.js';
export { reportInvariants } from './report.js';
