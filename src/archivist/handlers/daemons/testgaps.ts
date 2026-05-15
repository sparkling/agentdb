// charter: dispatch
// daemon_testgaps mutation handler (ADR-0180 Phase 5 §Architecture · Audit chain).
// Registers the 60-minute scheduled `testgaps` worker write as a
// `GuardedWrite<TestGapsWorkerPayload>` so each test-coverage-gap snapshot
// transition flows through the archivist's audit-chain (intent →
// applied | rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing daemon callsite: `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts`
// `runTestGapsWorkerLocal` method (line 1455), reached via the scheduler entry
// `{ type: 'testgaps', intervalMs: 60 * 60 * 1000, ... }` (line 111) and the
// dispatch switch at line 1245. The worker writes
// `.claude-flow/metrics/test-gaps.json` via `writeFileSync` — under ADR-0180
// F4-3 the daemon callsite stays in place; this file establishes the
// registration shape the dispatch path will resolve once wired.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// `.claude-flow/metrics/test-gaps.json` may mutate. The underlying primitive
// is `makeFsJsonSubstrate` (substrates/fs-json-store.ts), shared across
// daemon worker writes under one cross-process O_EXCL sentinel lock.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/**
 * Mutation payload for the daemon-scheduled testgaps worker. The
 * `runTestGapsWorkerLocal` method (worker-daemon.ts:1455-1475) takes no
 * caller-supplied arguments; the payload is intentionally empty so the audit
 * record captures "the scheduler fired" without coupling to internal worker
 * state.
 */
export interface TestGapsWorkerPayload {
  // intentionally empty — daemon-scheduled, no external inputs
}

const STORE_ID = 'metrics_test_gaps' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up, F4-3 deferral): port the scan body of
// worker-daemon.ts `runTestGapsWorkerLocal` (lines 1455-1475) once the
// dispatch boundary is wired through the daemon. The current cli body
// composes a `{ timestamp, mode, hasTestDir, estimatedCoverage, gaps, note }`
// snapshot via two `existsSync` probes (`tests/`, `__tests__/`) and then
// `writeFileSync(.../test-gaps.json, ...)`. Probes are read-only filesystem
// reads and therefore stay outside the `withWrite` scope; only the final
// JSON write moves inside. Note the file name on disk uses the hyphenated
// form (`test-gaps.json`) while the daemon worker type / handler name use
// the unhyphenated form (`testgaps` / `daemon_testgaps`) — matching the
// pre-existing cli surface.
export const testGapsWorkerHandler: GuardedWrite<TestGapsWorkerPayload> =
  registerMutationHandler<TestGapsWorkerPayload>(
    'daemon_testgaps',
    async (ctx: MutationContext<false>, _payload: TestGapsWorkerPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: daemon_testgaps handler body pending Phase 5 wire-up; ' +
          'callers currently route through forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts ' +
          '\'runTestGapsWorkerLocal\' method',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
