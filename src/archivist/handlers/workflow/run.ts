// charter: dispatch
// workflow_run mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<WorkflowRunPayload>` so every workflow run
// transitions through the archivist's audit chain (intent → applied | rejected)
// with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/workflow-tools.ts` `workflow_run`
// handler — load → build stages from template (feature/bugfix/refactor/security/
// custom) → mint workflowId → write workflow record under `withWorkflowLock`
// (ADR-0094 P9 — POSIX O_EXCL lockfile). The substrate's `withWrite` subsumes
// `withWorkflowLock`; cli callsites stay in place until the dispatch boundary
// is wired through cli. This file establishes the registration shape the
// dispatch path will resolve.
//
// FS-JSON store family: workflow state lives in `.claude-flow/workflows/store.json`
// — same atomic tmp+rename file family that hive-mind, claims, agents.json
// share. Routed through `makeFsJsonSubstrate` per ADR-0180 §10 "~18 stores per
// primitive".
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// workflow state may mutate. Direct `fs.writeFileSync` on store.json from
// store-tree code is forbidden by the `no-restricted-imports` backstop and
// the path-restricted substrate-internal.ts seam (ADR-0180 §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

/** Workflow run options — mirrors the cli inputSchema. `dryRun=true` short-circuits
 *  the mutation path; the cli still returns a validated-stage shape. */
export interface WorkflowRunOptions {
  readonly parallel?: boolean;
  readonly maxAgents?: number;
  readonly timeout?: number;
  readonly dryRun?: boolean;
}

/** Mutation payload for workflow_run. Template defaults to 'custom'. */
export interface WorkflowRunPayload {
  readonly template?: string;
  readonly file?: string;
  readonly task?: string;
  readonly options?: WorkflowRunOptions;
}

const STORE_ID = 'workflow_run' as StoreId;

// TODO(ADR-0180 Phase 5 wire-up): port the body of workflow-tools.ts
// `workflow_run` handler once the dispatch boundary is wired through cli. The
// cli's `loadWorkflowStore` → template stage expansion → mint workflowId →
// build steps[] → `saveWorkflowStore` sequence collapses to a single
// `ctx.substrate.withWrite` because the primitive owns the lock semantics.
// `withWorkflowLock` becomes redundant under the substrate's O_EXCL sentinel.
export const runWorkflowHandler: GuardedWrite<WorkflowRunPayload> =
  registerMutationHandler<WorkflowRunPayload>(
    'workflow_run',
    async (ctx: MutationContext<false>, _payload: WorkflowRunPayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: workflow_run handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/workflow-tools.ts workflow_run handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
