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
} from '../../index';

/** Mutation payload for workflow_execute. `workflowId` required; `variables`
 *  merges into the workflow's variables map; `startFromStep` is 0-indexed and
 *  defaults to 0 at the cli boundary. */
export interface WorkflowExecutePayload {
  readonly workflowId: string;
  readonly variables?: Record<string, unknown>;
  readonly startFromStep?: number;
}

const STORE_ID = 'workflow_execute' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of workflow-tools.ts
// `workflow_execute` handler once the dispatch boundary is wired through cli.
// The cli's load → guard → merge-variables → flip-status → save sequence
// collapses to a single `ctx.substrate.withWrite`. The "not-found" and
// "already-running" guards become typed verdicts in the audit chain rather
// than ad-hoc returned error shapes.
export const executeWorkflowHandler: GuardedWrite<WorkflowExecutePayload> =
  registerMutationHandler<WorkflowExecutePayload>(
    'workflow_execute',
    async (ctx: MutationContext<false>, _payload: WorkflowExecutePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: workflow_execute handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/workflow-tools.ts workflow_execute handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
