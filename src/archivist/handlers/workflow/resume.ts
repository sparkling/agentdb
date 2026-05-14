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

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/** Mutation payload for workflow_resume. `workflowId` required. */
export interface WorkflowResumePayload {
  readonly workflowId: string;
}

const STORE_ID = 'workflow_resume' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of workflow-tools.ts
// `workflow_resume` handler once the dispatch boundary is wired through cli.
// The cli's load → guard `status === 'paused'` → flip status → save
// sequence collapses to a single `ctx.substrate.withWrite`. The "not-found"
// and "not-paused" guards become typed verdicts in the audit chain.
export const resumeWorkflowHandler: GuardedWrite<WorkflowResumePayload> =
  registerMutationHandler<WorkflowResumePayload>(
    'workflow_resume',
    async (ctx: MutationContext<false>, _payload: WorkflowResumePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: workflow_resume handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/workflow-tools.ts workflow_resume handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
