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

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';
import type { WorkflowRecord, WorkflowStep, WorkflowStore } from './shared.js';

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

/** Template → stage-name expansion — mirrors workflow-tools.ts:183-196. */
function stageNamesForTemplate(template: string): string[] {
  switch (template) {
    case 'feature':
      return ['Research', 'Design', 'Implement', 'Test', 'Review'];
    case 'bugfix':
      return ['Investigate', 'Fix', 'Test', 'Review'];
    case 'refactor':
      return ['Analyze', 'Refactor', 'Test', 'Review'];
    case 'security':
      return ['Scan', 'Analyze', 'Report'];
    default:
      return ['Execute'];
  }
}

// Ported from workflow-tools.ts `workflow_run` handler. The cli's
// `loadWorkflowStore` → template stage expansion → mint workflowId →
// build steps[] → `saveWorkflowStore` sequence collapses to a single
// `ctx.substrate.withWrite` — the substrate primitive owns the O_EXCL lock,
// subsuming the cli's `withWorkflowLock`. `dryRun=true` short-circuits before
// taking the lock: it never mutates the store (the validated-stage shape was
// a cli-return concern; under the void mutation contract dryRun is a no-op).
export const runWorkflowHandler: GuardedWrite<WorkflowRunPayload> =
  registerMutationHandler<WorkflowRunPayload>(
    'workflow_run',
    async (ctx: MutationContext<false>, payload: WorkflowRunPayload): Promise<void> => {
      const options = payload.options ?? {};
      if (options.dryRun === true) {
        return;
      }

      const templateName = payload.template || 'custom';
      const stageNames = stageNamesForTemplate(templateName);
      const steps: WorkflowStep[] = stageNames.map((name, i) => ({
        stepId: `step-${i + 1}`,
        name,
        type: 'task' as const,
        config: { task: payload.task || name },
        status: 'pending' as const,
      }));

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<WorkflowStore>({ storeId: STORE_ID, key: 'root' });
        const store: WorkflowStore = current ?? { workflows: {}, templates: {}, version: '3.0.0' };

        const workflowId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const workflow: WorkflowRecord = {
          workflowId,
          name: payload.task || `${templateName} workflow`,
          description: payload.task,
          steps,
          status: 'running',
          currentStep: 0,
          variables: { template: templateName, ...options },
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
        };

        store.workflows[workflowId] = workflow;
        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
