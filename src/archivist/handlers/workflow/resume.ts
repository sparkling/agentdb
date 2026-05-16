// charter: dispatch
// workflow_resume mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<WorkflowResumePayload>` so the `paused → running`
// state transition flows through the archivist's audit chain with guard
// verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/workflow-tools.ts`
// `workflow_resume` handler — load → guard `workflow != null` → guard
// `status === 'paused'` → flip status to `running` → save → report step
// states (no auto-completion; actual step execution requires agent assignment
// via task tools). The cli body does NOT wrap in `withWorkflowLock`; the
// substrate's `withWrite` enforces serialization to prevent concurrent
// pause/resume races.
//
// FS-JSON store family: shares `.claude-flow/workflows/store.json` —
// routed through `makeFsJsonSubstrate`.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// workflow status may transition; direct fs writes are forbidden.

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';
import type { WorkflowStore } from './shared.js';

/** Mutation payload for workflow_resume. `workflowId` required. */
export interface WorkflowResumePayload {
  readonly workflowId: string;
}

const STORE_ID = 'workflow_resume' as StoreId;

// Ported from workflow-tools.ts `workflow_resume` handler. The cli's
// load → guard `status === 'paused'` → flip status → save sequence collapses
// to a single `ctx.substrate.withWrite`. The "not-found" and "not-paused"
// guards throw fail-loud under the void mutation contract. No step
// auto-completion — steps stay in their current state (actual execution
// requires agent assignment via task tools).
export const resumeWorkflowHandler: GuardedWrite<WorkflowResumePayload> =
  registerMutationHandler<WorkflowResumePayload>(
    'workflow_resume',
    async (ctx: MutationContext<false>, payload: WorkflowResumePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<WorkflowStore>({ storeId: STORE_ID, key: 'root' });
        const store: WorkflowStore = current ?? { workflows: {}, templates: {}, version: '3.0.0' };

        const workflow = store.workflows[payload.workflowId];
        if (!workflow) {
          throw new Error(`archivist: workflow_resume — workflow not found: ${payload.workflowId}`);
        }
        if (workflow.status !== 'paused') {
          throw new Error(
            `archivist: workflow_resume — workflow not paused (status: ${workflow.status}): ${payload.workflowId}`,
          );
        }

        workflow.status = 'running';
        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
