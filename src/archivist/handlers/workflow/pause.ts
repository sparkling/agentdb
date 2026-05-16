// charter: dispatch
// workflow_pause mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<WorkflowPausePayload>` so the `running → paused`
// state transition flows through the archivist's audit chain with guard
// verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/workflow-tools.ts`
// `workflow_pause` handler — load → guard `workflow != null` → guard
// `status === 'running'` → flip status to `paused` → save. Like
// workflow_execute, the cli body is currently not wrapped in
// `withWorkflowLock`; the substrate's `withWrite` enforces serialization to
// prevent a concurrent pause/resume/cancel from racing the read-modify-write.
//
// FS-JSON store family: shares `.claude-flow/workflows/store.json` —
// routed through `makeFsJsonSubstrate`.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// workflow status may transition; direct fs writes are forbidden.

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';
import { pauseInvariants } from '../../invariants/workflow/pause.js';
import type { WorkflowStore } from './shared.js';

/** Mutation payload for workflow_pause. `workflowId` required. */
export interface WorkflowPausePayload {
  readonly workflowId: string;
}

const STORE_ID = 'workflow_pause' as StoreId;

// Ported from workflow-tools.ts `workflow_pause` handler. The cli's
// load → guard `status === 'running'` → flip status → save sequence collapses
// to a single `ctx.substrate.withWrite`. The "not-found" and "not-running"
// guards throw fail-loud under the void mutation contract.
export const pauseWorkflowHandler: GuardedWrite<WorkflowPausePayload> =
  registerMutationHandler<WorkflowPausePayload>(
    'workflow_pause',
    async (ctx: MutationContext<false>, payload: WorkflowPausePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<WorkflowStore>({ storeId: STORE_ID, key: 'root' });
        const store: WorkflowStore = current ?? { workflows: {}, templates: {}, version: '3.0.0' };

        const workflow = store.workflows[payload.workflowId];
        if (!workflow) {
          throw new Error(`archivist: workflow_pause — workflow not found: ${payload.workflowId}`);
        }
        if (workflow.status !== 'running') {
          throw new Error(
            `archivist: workflow_pause — workflow not running (status: ${workflow.status}): ${payload.workflowId}`,
          );
        }

        workflow.status = 'paused';
        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: pauseInvariants,
      cacheScope: 'store',
    },
  );
