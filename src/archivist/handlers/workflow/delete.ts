// charter: dispatch
// workflow_delete mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<WorkflowDeletePayload>` so every record removal
// flows through the archivist's audit chain — destructive transitions MUST be
// audited with guard verdicts so a deleted workflow is recoverable from the
// audit log if the deletion turns out to be erroneous.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/workflow-tools.ts`
// `workflow_delete` handler — load → guard `store.workflows[workflowId] != null`
// → guard `status != 'running'` → delete record → save. The cli body does NOT
// wrap in `withWorkflowLock`; the substrate's `withWrite` enforces serialization
// to prevent a concurrent execute/pause/resume from observing the deleted
// record mid-flight.
//
// FS-JSON store family: shares `.claude-flow/workflows/store.json` —
// routed through `makeFsJsonSubstrate`.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// workflow records may be removed; direct fs writes are forbidden.

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';
import type { WorkflowStore } from './shared.js';

/** Mutation payload for workflow_delete. `workflowId` required. */
export interface WorkflowDeletePayload {
  readonly workflowId: string;
}

const STORE_ID = 'workflow_delete' as StoreId;

// Ported from workflow-tools.ts `workflow_delete` handler. The cli's
// load → guard-exists → guard-not-running → delete → save sequence collapses
// to a single `ctx.substrate.withWrite`. The "not-found" and "running" guards
// throw fail-loud under the void mutation contract.
export const deleteWorkflowHandler: GuardedWrite<WorkflowDeletePayload> =
  registerMutationHandler<WorkflowDeletePayload>(
    'workflow_delete',
    async (ctx: MutationContext<false>, payload: WorkflowDeletePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<WorkflowStore>({ storeId: STORE_ID, key: 'root' });
        const store: WorkflowStore = current ?? { workflows: {}, templates: {}, version: '3.0.0' };

        const workflow = store.workflows[payload.workflowId];
        if (!workflow) {
          throw new Error(`archivist: workflow_delete — workflow not found: ${payload.workflowId}`);
        }
        if (workflow.status === 'running') {
          throw new Error(
            `archivist: workflow_delete — cannot delete running workflow: ${payload.workflowId}`,
          );
        }

        delete store.workflows[payload.workflowId];
        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
