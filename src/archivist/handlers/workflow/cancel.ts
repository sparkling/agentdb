// charter: dispatch
// workflow_cancel mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<WorkflowCancelPayload>` so the transition to
// terminal `failed` state flows through the archivist's audit chain — every
// cancellation MUST be recorded with the reason as part of the audit shape.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/workflow-tools.ts`
// `workflow_cancel` handler — load → guard `workflow != null` → guard
// `status != 'completed' && status != 'failed'` → flip status to `failed`
// → set `error = reason || 'Cancelled by user'` → set completedAt → mark
// remaining steps `skipped` → save. The cli body does NOT wrap in
// `withWorkflowLock`; the substrate's `withWrite` enforces serialization.
//
// FS-JSON store family: shares `.claude-flow/workflows/store.json` —
// routed through `makeFsJsonSubstrate`.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// workflow state may transition; direct fs writes are forbidden.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/** Mutation payload for workflow_cancel. `workflowId` required;
 *  `reason` is recorded on the workflow record as `error`. */
export interface WorkflowCancelPayload {
  readonly workflowId: string;
  readonly reason?: string;
}

const STORE_ID = 'workflow_cancel' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of workflow-tools.ts
// `workflow_cancel` handler once the dispatch boundary is wired through cli.
// The cli's load → guard-not-terminal → flip status → set error → set
// completedAt → skip remaining steps → save sequence collapses to a single
// `ctx.substrate.withWrite`. The "not-found" and "already-finished" guards
// become typed verdicts in the audit chain.
export const cancelWorkflowHandler: GuardedWrite<WorkflowCancelPayload> =
  registerMutationHandler<WorkflowCancelPayload>(
    'workflow_cancel',
    async (ctx: MutationContext<false>, _payload: WorkflowCancelPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: workflow_cancel handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/workflow-tools.ts workflow_cancel handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
