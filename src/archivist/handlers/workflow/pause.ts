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

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/** Mutation payload for workflow_pause. `workflowId` required. */
export interface WorkflowPausePayload {
  readonly workflowId: string;
}

const STORE_ID = 'workflow_pause' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of workflow-tools.ts
// `workflow_pause` handler once the dispatch boundary is wired through cli.
// The cli's load → guard `status === 'running'` → flip status sequence
// collapses to a single `ctx.substrate.withWrite`. The "not-found" and
// "not-running" guards become typed verdicts in the audit chain.
export const pauseWorkflowHandler: GuardedWrite<WorkflowPausePayload> =
  registerMutationHandler<WorkflowPausePayload>(
    'workflow_pause',
    async (ctx: MutationContext<false>, _payload: WorkflowPausePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: workflow_pause handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/workflow-tools.ts workflow_pause handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
