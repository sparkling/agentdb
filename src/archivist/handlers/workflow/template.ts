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

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

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

// TODO(ADR-0180 Phase 5 wire-up): port the body of workflow-tools.ts
// `workflow_template` handler once the dispatch boundary is wired through cli.
// The cli's switch-on-action sequence collapses to a single
// `ctx.substrate.withWrite` callback that branches on `payload.action`. The
// "workflow not found" / "template not found" / "unknown action" guards
// become typed verdicts in the audit chain. Post wire-up, consider splitting
// the `list` action into a sibling `GuardedRead<WorkflowTemplateListQuery, ...>`
// handler so the read path doesn't take the write lock unnecessarily.
export const templateWorkflowHandler: GuardedWrite<WorkflowTemplatePayload> =
  registerMutationHandler<WorkflowTemplatePayload>(
    'workflow_template',
    async (ctx: MutationContext<false>, _payload: WorkflowTemplatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: workflow_template handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/workflow-tools.ts workflow_template handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
