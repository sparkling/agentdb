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

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';

/** Mutation payload for workflow_delete. `workflowId` required. */
export interface WorkflowDeletePayload {
  readonly workflowId: string;
}

const STORE_ID = 'workflow_delete' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of workflow-tools.ts
// `workflow_delete` handler once the dispatch boundary is wired through cli.
// The cli's load → guard-exists → guard-not-running → delete → save sequence
// collapses to a single `ctx.substrate.withWrite`. The "not-found" and
// "running" guards become typed verdicts in the audit chain.
export const deleteWorkflowHandler: GuardedWrite<WorkflowDeletePayload> =
  registerMutationHandler<WorkflowDeletePayload>(
    'workflow_delete',
    async (ctx: MutationContext<false>, _payload: WorkflowDeletePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: workflow_delete handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/workflow-tools.ts workflow_delete handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
