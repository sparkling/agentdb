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

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';
import { cancelInvariants } from '../../invariants/workflow/cancel.js';
import type { WorkflowStore } from './shared.js';

/** Mutation payload for workflow_cancel. `workflowId` required;
 *  `reason` is recorded on the workflow record as `error`. */
export interface WorkflowCancelPayload {
  readonly workflowId: string;
  readonly reason?: string;
}

const STORE_ID = 'workflow_cancel' as StoreId;

// Ported from workflow-tools.ts `workflow_cancel` handler. The cli's
// load → guard-not-terminal → flip status → set error → set completedAt →
// skip remaining steps → save sequence collapses to a single
// `ctx.substrate.withWrite`. The "not-found" and "already-finished" guards
// throw fail-loud (the cli returned error shapes; under the void mutation
// contract an unsatisfiable precondition is a thrown error).
export const cancelWorkflowHandler: GuardedWrite<WorkflowCancelPayload> =
  registerMutationHandler<WorkflowCancelPayload>(
    'workflow_cancel',
    async (ctx: MutationContext<false>, payload: WorkflowCancelPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<WorkflowStore>({ storeId: STORE_ID, key: 'root' });
        const store: WorkflowStore = current ?? { workflows: {}, templates: {}, version: '3.0.0' };

        const workflow = store.workflows[payload.workflowId];
        if (!workflow) {
          throw new Error(`archivist: workflow_cancel — workflow not found: ${payload.workflowId}`);
        }
        if (workflow.status === 'completed' || workflow.status === 'failed') {
          throw new Error(
            `archivist: workflow_cancel — workflow already finished (status: ${workflow.status}): ${payload.workflowId}`,
          );
        }

        workflow.status = 'failed';
        workflow.error = payload.reason ?? 'Cancelled by user';
        workflow.completedAt = new Date().toISOString();
        for (let i = workflow.currentStep; i < workflow.steps.length; i++) {
          workflow.steps[i].status = 'skipped';
        }

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: cancelInvariants,
      cacheScope: 'store',
    },
  );
