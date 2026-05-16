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

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';

/**
 * Mutation payload for the daemon-scheduled testgaps worker.
 *
 * The cli's `runTestGapsWorkerLocal` (worker-daemon.ts:1534-1554) composes
 * the snapshot from two `existsSync` probes (`tests/`, `__tests__/`) — those
 * are filesystem reads the *daemon* performs on its own stack and are NOT a
 * substrate concern (matches the `optimize.ts` / `consolidate.ts` precedent:
 * the cli runs the work, the handler owns persistence only). So the snapshot
 * arrives here fully-composed in the payload; the handler writes it verbatim.
 *
 * `mode` discriminates the two execution paths:
 *   - `'local'` — `runTestGapsWorkerLocal` fallback (worker-daemon.ts:1534).
 *     Carries `hasTestDir`, `estimatedCoverage`, `gaps`, `note`.
 *   - `'headless'` — `persistHeadlessResult` (worker-daemon.ts:1355). Carries
 *     `model`, `durationMs`, `tokensUsed`, `executionId`, `success`,
 *     `findings`, `rawOutputPreview`, `rawOutputLength`. Both modes write to
 *     the same file (`test-gaps.json`), so a single mutation handler covers
 *     both; the on-disk schema diverges by `mode` exactly as the cli
 *     produces today.
 */
export type TestGapsWorkerPayload =
  | {
      readonly timestamp: string;
      readonly mode: 'local';
      readonly hasTestDir: boolean;
      readonly estimatedCoverage: string;
      readonly gaps: ReadonlyArray<unknown>;
      readonly note: string;
    }
  | {
      readonly timestamp: string;
      readonly mode: 'headless';
      readonly workerType: string;
      readonly model?: string;
      readonly durationMs?: number;
      readonly tokensUsed?: number;
      readonly executionId?: string;
      readonly success: boolean;
      readonly findings: unknown;
      readonly rawOutputPreview?: string;
      readonly rawOutputLength: number;
    };

const STORE_ID = 'metrics_test_gaps' as StoreId;

// F4-2 body: snapshot is composed daemon-side (existsSync probes are
// filesystem reads, not a substrate concern — `optimize.ts` precedent) and
// arrives in the payload; this handler owns persistence only. One `withWrite`
// scope → one `handle.write` of the whole document. The cli
// `writeFileSync(.../test-gaps.json)` at worker-daemon.ts:1552 (local) and
// 1395 (headless) collapses to this call once F4-3 flips the daemon switch
// to `archivist.dispatch('daemon_testgaps', snapshot)`.
export const testGapsWorkerHandler: GuardedWrite<TestGapsWorkerPayload> =
  registerMutationHandler<TestGapsWorkerPayload>(
    'daemon_testgaps',
    async (ctx: MutationContext<false>, payload: TestGapsWorkerPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        await handle.write({ storeId: STORE_ID, key: 'root', payload });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'global',
    },
  );
