// charter: dispatch
// daa_workflow_execute mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<DaaWorkflowExecutePayload>` so every DAA workflow
// execution transitions through the archivist's audit chain
// (intent → applied | rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/daa-tools.ts`
// `daa_workflow_execute` handler — wraps load → mutate
// (workflow.status = 'running') → save under `withDAALock` (ADR-0129 B1 —
// POSIX O_EXCL lockfile). The lock is the fix for the recorded race where
// `daa_workflow_execute` observed a stale pre-image (missing the workflow
// that a concurrent `daa_workflow_create` had just inserted) and returned
// `Workflow not found`. The substrate's `withWrite` subsumes `withDAALock`;
// cli callsites stay in place until the dispatch boundary is wired through
// cli. This file establishes the registration shape the dispatch path will
// resolve.
//
// FS-JSON store family: shares `.claude-flow/daa/store.json` with the other
// daa_* mutations — routed through `makeFsJsonSubstrate`.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// DAA workflow state may mutate. Direct `fs.writeFileSync` on store.json is
// forbidden by the path-restricted substrate-internal.ts seam
// (ADR-0180 §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/**
 * Mutation payload mirroring the CLI tool's `daa_workflow_execute` input
 * shape (daa-tools.ts:347-352).
 */
export interface DaaWorkflowExecutePayload {
  readonly workflowId: string;
  readonly agentIds?: ReadonlyArray<string>;
  readonly parallelExecution?: boolean;
}

const STORE_ID = 'daa' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of daa-tools.ts
// `daa_workflow_execute` callsite (load store → reject if workflow missing →
// workflow.status = 'running' → save). The cli's outer `withDAALock`
// collapses to a single `ctx.substrate.withWrite` because the substrate
// primitive owns the lock semantics (ADR-0129 B1 race-fix preserved under
// the substrate's O_EXCL sentinel). Step auto-execution remains out of scope
// per the cli's `_note` — only the status transition is durable; runtime
// step orchestration is left to agent tools.
export const daaWorkflowExecuteHandler: GuardedWrite<DaaWorkflowExecutePayload> =
  registerMutationHandler<DaaWorkflowExecutePayload>(
    'daa_workflow_execute',
    async (ctx: MutationContext<false>, _payload: DaaWorkflowExecutePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: daa_workflow_execute handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/daa-tools.ts daa_workflow_execute handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
