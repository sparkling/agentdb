// charter: dispatch
// workflow_execute mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<WorkflowExecutePayload>` so every state transition
// from `ready`/`paused` to `running` flows through the archivist's audit chain
// with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/workflow-tools.ts`
// `workflow_execute` handler — load → guard `workflow != null` → guard
// `status != 'running'` → merge runtime variables → flip status to `running`
// → set startedAt + currentStep → mark remaining steps `pending` (actual
// step execution requires agent assignment via task tools — this handler
// only owns state transitions) → save. The cli body does NOT currently
// wrap in `withWorkflowLock`, but the substrate's `withWrite` enforces
// serialization to prevent the load→mutate→save race that would otherwise
// allow two concurrent execute calls to clobber each other.
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
import type { WorkflowStore } from './shared.js';

/** Mutation payload for workflow_execute. `workflowId` required; `variables`
 *  merges into the workflow's variables map; `startFromStep` is 0-indexed and
 *  defaults to 0 at the cli boundary. */
export interface WorkflowExecutePayload {
  readonly workflowId: string;
  readonly variables?: Record<string, unknown>;
  readonly startFromStep?: number;
}

const STORE_ID = 'workflow_execute' as StoreId;

// Ported from workflow-tools.ts `workflow_execute` handler. The cli's
// load → guard → merge-variables → flip-status → mark-steps-pending → save
// sequence collapses to a single `ctx.substrate.withWrite`. The "not-found"
// and "already-running" guards throw fail-loud under the void mutation
// contract. Actual step execution requires agent assignment via task tools —
// this handler only owns the state transition.
export const executeWorkflowHandler: GuardedWrite<WorkflowExecutePayload> =
  registerMutationHandler<WorkflowExecutePayload>(
    'workflow_execute',
    async (ctx: MutationContext<false>, payload: WorkflowExecutePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<WorkflowStore>({ storeId: STORE_ID, key: 'root' });
        const store: WorkflowStore = current ?? { workflows: {}, templates: {}, version: '3.0.0' };

        const workflow = store.workflows[payload.workflowId];
        if (!workflow) {
          throw new Error(`archivist: workflow_execute — workflow not found: ${payload.workflowId}`);
        }
        if (workflow.status === 'running') {
          throw new Error(
            `archivist: workflow_execute — workflow already running: ${payload.workflowId}`,
          );
        }

        if (payload.variables) {
          workflow.variables = { ...workflow.variables, ...payload.variables };
        }
        workflow.status = 'running';
        workflow.startedAt = new Date().toISOString();
        workflow.currentStep = payload.startFromStep ?? 0;
        for (let i = workflow.currentStep; i < workflow.steps.length; i++) {
          workflow.steps[i].status = 'pending';
        }

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
