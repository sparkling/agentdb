// charter: dispatch
// workflow_create mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<WorkflowCreatePayload>` so every create transitions
// through the archivist's audit chain (intent → applied | rejected) with guard
// verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/workflow-tools.ts`
// `workflow_create` handler — validates `name`/`steps` (P11/P12 fail-fast
// before lock) → `withWorkflowLock` (ADR-0094 P9) → name-based idempotency
// check (winner-returns-existing) → mint workflowId → write under
// `saveWorkflowStore`. The substrate's `withWrite` subsumes `withWorkflowLock`;
// the in-critical-section idempotency check stays intact during wire-up to
// preserve ADR-0094 P9 "exactly-one-winner" semantics for concurrent racers
// calling with the same `name`.
//
// FS-JSON store family: shares `.claude-flow/workflows/store.json` with the
// other workflow_* mutations — routed through `makeFsJsonSubstrate`.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// workflow records may be inserted; direct fs writes are forbidden by the
// path-restricted substrate-internal.ts seam (ADR-0180 §Type enforcement).

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index.js';
import type { WorkflowRecord, WorkflowStep, WorkflowStore } from './shared.js';

/** Workflow step type discriminator — matches the cli inputSchema enum. */
export type WorkflowStepType = 'task' | 'condition' | 'parallel' | 'loop' | 'wait';

/** Mutation payload step shape — `stepId` minted server-side as `step-${i+1}`,
 *  not provided by the caller. */
export interface WorkflowCreateStep {
  readonly name?: string;
  readonly type?: WorkflowStepType;
  readonly config?: Record<string, unknown>;
}

/** Mutation payload for workflow_create. `name` + `steps` are required at the
 *  cli boundary; validation rejects empty `name`, missing `steps`, non-array
 *  `steps`, and empty `steps[]` with named-error shapes (ADR-0094 P11/P12). */
export interface WorkflowCreatePayload {
  readonly name: string;
  readonly description?: string;
  readonly steps: ReadonlyArray<WorkflowCreateStep>;
  readonly variables?: Record<string, unknown>;
}

const STORE_ID = 'workflow_create' as StoreId;

// Ported from workflow-tools.ts `workflow_create` handler. P11/P12 validation
// runs fail-loud at the head of the handler (the cli returned named error
// shapes pre-lock; under the void-returning mutation contract an invalid
// payload is a thrown error, not a silent return). The cli's `withWorkflowLock`
// is subsumed by `ctx.substrate.withWrite` — the substrate primitive owns the
// O_EXCL lock. The name-idempotency check stays INSIDE the `withWrite` callback
// so a losing racer observes the winner's insert (ADR-0094 P9 exactly-one-winner).
export const createWorkflowHandler: GuardedWrite<WorkflowCreatePayload> =
  registerMutationHandler<WorkflowCreatePayload>(
    'workflow_create',
    async (ctx: MutationContext<false>, payload: WorkflowCreatePayload): Promise<void> => {
      // P11/P12 fail-fast validation — before taking the substrate lock.
      if (typeof payload.name !== 'string' || payload.name.length === 0) {
        throw new Error(
          `archivist: workflow_create requires a non-empty 'name' string (field: name)`,
        );
      }
      if (!Array.isArray(payload.steps) || payload.steps.length === 0) {
        throw new Error(
          `archivist: workflow_create requires a non-empty 'steps' array (field: steps)`,
        );
      }

      const steps: WorkflowStep[] = payload.steps.map((s, i) => ({
        stepId: `step-${i + 1}`,
        name: s.name || `Step ${i + 1}`,
        type: s.type ?? 'task',
        config: s.config ?? {},
        status: 'pending' as const,
      }));

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<WorkflowStore>({ storeId: STORE_ID, key: 'root' });
        const store: WorkflowStore = current ?? { workflows: {}, templates: {}, version: '3.0.0' };

        // Name-based idempotency (ADR-0094 P9): a losing racer returns without
        // minting a duplicate when the winner already inserted this name.
        const existing = Object.values(store.workflows).find((w) => w.name === payload.name);
        if (existing) {
          return;
        }

        const workflowId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const workflow: WorkflowRecord = {
          workflowId,
          name: payload.name,
          description: payload.description,
          steps,
          status: steps.length > 0 ? 'ready' : 'draft',
          currentStep: 0,
          variables: payload.variables ?? {},
          createdAt: new Date().toISOString(),
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
