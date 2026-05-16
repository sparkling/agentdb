// charter: dispatch
// workflow_template mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<WorkflowTemplatePayload>` because two of the three
// `action` discriminants (`save`, `create`) mutate the store — `save` inserts
// into `templates`, `create` inserts a workflow from a template. The `list`
// action is read-only but the handler registers as a write because the
// payload's `action` is not statically narrowable at registration time; the
// `list` path takes the substrate's `withWrite` no-op-ishly (no `handle.write`
// call) until the dispatch boundary splits read/write per action.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/workflow-tools.ts`
// `workflow_template` handler — switches on `action`:
//   - 'save'   → load → guard workflow exists → mint templateId →
//                clone workflow with reset step statuses → insert into
//                store.templates → save
//   - 'create' → load → guard template exists → mint workflowId →
//                clone template with `status='ready'` → insert into
//                store.workflows → save
//   - 'list'   → load → return projected template summaries (read-only)
//
// The cli body does NOT wrap in `withWorkflowLock`; the substrate's
// `withWrite` enforces serialization to prevent a concurrent
// `save`+`create` from racing on the same store.
//
// FS-JSON store family: shares `.claude-flow/workflows/store.json` —
// routed through `makeFsJsonSubstrate`.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// templates or workflows may be inserted via this handler.

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';
import { templateInvariants } from '../../invariants/workflow/template.js';
import type { WorkflowRecord, WorkflowStore } from './shared.js';

/** Template action discriminator — matches the cli inputSchema enum. */
export type WorkflowTemplateAction = 'save' | 'create' | 'list';

/** Mutation payload for workflow_template, discriminated by `action`.
 *  - save:   requires `workflowId`; `templateName` optional (defaults to
 *            `${workflow.name} Template`).
 *  - create: requires `templateId`; `newName` optional (defaults to
 *            template.name with ' Template' stripped).
 *  - list:   no other fields used. */
export interface WorkflowTemplatePayload {
  readonly action: WorkflowTemplateAction;
  readonly workflowId?: string;
  readonly templateId?: string;
  readonly templateName?: string;
  readonly newName?: string;
}

const STORE_ID = 'workflow_template' as StoreId;

// Ported from workflow-tools.ts `workflow_template` handler. The cli's
// switch-on-action sequence collapses to a single `ctx.substrate.withWrite`
// callback that branches on `payload.action`. `save` and `create` mutate;
// `list` is read-only and takes the write scope as a no-op (no `handle.write`)
// until the dispatch boundary splits read/write per action — at which point
// `list` migrates to a sibling `GuardedRead`. The "workflow not found" /
// "template not found" / "unknown action" guards throw fail-loud under the
// void mutation contract.
export const templateWorkflowHandler: GuardedWrite<WorkflowTemplatePayload> =
  registerMutationHandler<WorkflowTemplatePayload>(
    'workflow_template',
    async (ctx: MutationContext<false>, payload: WorkflowTemplatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<WorkflowStore>({ storeId: STORE_ID, key: 'root' });
        const store: WorkflowStore = current ?? { workflows: {}, templates: {}, version: '3.0.0' };

        switch (payload.action) {
          case 'save': {
            if (typeof payload.workflowId !== 'string') {
              throw new Error(
                `archivist: workflow_template save — 'workflowId' is required (field: workflowId)`,
              );
            }
            const workflow = store.workflows[payload.workflowId];
            if (!workflow) {
              throw new Error(
                `archivist: workflow_template save — workflow not found: ${payload.workflowId}`,
              );
            }

            const templateId = `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const template: WorkflowRecord = {
              ...workflow,
              workflowId: templateId,
              name: payload.templateName || `${workflow.name} Template`,
              status: 'draft',
              currentStep: 0,
              createdAt: new Date().toISOString(),
              startedAt: undefined,
              completedAt: undefined,
              steps: workflow.steps.map((s) => ({
                ...s,
                status: 'pending' as const,
                result: undefined,
                startedAt: undefined,
                completedAt: undefined,
              })),
            };

            store.templates[templateId] = template;
            await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
            return;
          }

          case 'create': {
            if (typeof payload.templateId !== 'string') {
              throw new Error(
                `archivist: workflow_template create — 'templateId' is required (field: templateId)`,
              );
            }
            const template = store.templates[payload.templateId];
            if (!template) {
              throw new Error(
                `archivist: workflow_template create — template not found: ${payload.templateId}`,
              );
            }

            const workflowId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const workflow: WorkflowRecord = {
              ...template,
              workflowId,
              name: payload.newName || template.name.replace(' Template', ''),
              status: 'ready',
              createdAt: new Date().toISOString(),
            };

            store.workflows[workflowId] = workflow;
            await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
            return;
          }

          case 'list':
            // Read-only — takes the write scope as a no-op until the dispatch
            // boundary splits read/write per action.
            return;

          default:
            throw new Error(
              `archivist: workflow_template — unknown action: ${String((payload as { action: unknown }).action)}`,
            );
        }
      });
    },
    {
      invariants: templateInvariants,
      cacheScope: 'store',
    },
  );
