// charter: dispatch
// workflow_create mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<WorkflowCreatePayload>` so every create transitions
// through the archivist's audit chain (intent → applied | rejected) with guard
// verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/workflow-tools.ts`
// `workflow_create` handler — validates `name`/`steps` (P11/P12 fail-fast
// before lock) → `withWorkflowLock` (ADR-0094 P9) → name-based idempotency
// check (winner-returns-existing) → mint workflowId → write under
// `saveWorkflowStore`. The substrate's `withWrite` subsumes `withWorkflowLock`;
// the in-critical-section idempotency check stays intact during wire-up to
// preserve ADR-0094 P9 "exactly-one-winner" semantics for concurrent racers
// calling with the same `name`.
//
// FS-JSON store family: shares `.claude-flow/workflows/store.json` with the
// other workflow_* mutations — routed through `makeFsJsonSubstrate`.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// workflow records may be inserted; direct fs writes are forbidden by the
// path-restricted substrate-internal.ts seam (ADR-0180 §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/** Workflow step type discriminator — matches the cli inputSchema enum. */
export type WorkflowStepType = 'task' | 'condition' | 'parallel' | 'loop' | 'wait';

/** Mutation payload step shape — `stepId` minted server-side as `step-${i+1}`,
 *  not provided by the caller. */
export interface WorkflowCreateStep {
  readonly name?: string;
  readonly type?: WorkflowStepType;
  readonly config?: Record<string, unknown>;
}

/** Mutation payload for workflow_create. `name` + `steps` are required at the
 *  cli boundary; validation rejects empty `name`, missing `steps`, non-array
 *  `steps`, and empty `steps[]` with named-error shapes (ADR-0094 P11/P12). */
export interface WorkflowCreatePayload {
  readonly name: string;
  readonly description?: string;
  readonly steps: ReadonlyArray<WorkflowCreateStep>;
  readonly variables?: Record<string, unknown>;
}

const STORE_ID = 'workflow_create' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of workflow-tools.ts
// `workflow_create` handler once the dispatch boundary is wired through cli.
// Pre-lock validation (P11/P12) stays at the cli boundary OR moves into a
// guard registered alongside this handler. The in-critical-section
// name-idempotency check is core to ADR-0094 P9 — when ported it MUST stay
// inside the `withWrite` callback (not before it) so a losing racer observes
// the winner's insert and returns the winner's workflowId rather than
// minting a duplicate.
export const createWorkflowHandler: GuardedWrite<WorkflowCreatePayload> =
  registerMutationHandler<WorkflowCreatePayload>(
    'workflow_create',
    async (ctx: MutationContext<false>, _payload: WorkflowCreatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: workflow_create handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/workflow-tools.ts workflow_create handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
