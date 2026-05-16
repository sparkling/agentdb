// charter: dispatch
// daa_workflow_execute mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<DaaWorkflowExecutePayload>` so every DAA workflow
// execution transitions through the archivist's audit chain
// (intent → applied | rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/daa-tools.ts`
// `daa_workflow_execute` handler — wraps load → mutate
// (workflow.status = 'running') → save under `withDAALock` (ADR-0129 B1 —
// POSIX O_EXCL lockfile). The lock is the fix for the recorded race where
// `daa_workflow_execute` observed a stale pre-image (missing the workflow
// that a concurrent `daa_workflow_create` had just inserted) and returned
// `Workflow not found`. The substrate's `withWrite` subsumes `withDAALock`;
// cli callsites stay in place until the dispatch boundary is wired through
// cli. This file establishes the registration shape the dispatch path will
// resolve.
//
// FS-JSON store family: shares `.claude-flow/daa/store.json` with the other
// daa_* mutations — routed through `makeFsJsonSubstrate`.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// DAA workflow state may mutate. Direct `fs.writeFileSync` on store.json is
// forbidden by the path-restricted substrate-internal.ts seam
// (ADR-0180 §Type enforcement).

import { registerMutationHandler } from '../../registration.js';
import type {
  GuardedWrite,
  MutationContext,
  StoreId,
} from '../../index.js';
import { emptyDaaStore, type DaaStore } from './agent-create.js';
import { workflowExecuteInvariants } from '../../invariants/daa/workflow-execute.js';

/**
 * Mutation payload mirroring the CLI tool's `daa_workflow_execute` input
 * shape (daa-tools.ts:347-352).
 */
export interface DaaWorkflowExecutePayload {
  readonly workflowId: string;
  readonly agentIds?: ReadonlyArray<string>;
  readonly parallelExecution?: boolean;
}

const STORE_ID = 'daa' as StoreId;

// Body ported from daa-tools.ts `daa_workflow_execute` handler (lines 361-381):
// load store → reject if workflow missing → workflow.status = 'running' →
// save. The cli's outer `withDAALock` collapses into the single
// `ctx.substrate.withWrite` because the substrate primitive owns the lock
// semantics — this is the read-modify-write the ADR-0129 B1 lock exists to
// serialise (the recorded race: `daa_workflow_execute` observing a stale
// pre-image missing a concurrently-created workflow and returning
// `Workflow not found`). Step auto-execution stays out of scope per the cli's
// `_note` — only the status transition is durable; runtime step orchestration
// is left to agent tools.
export const daaWorkflowExecuteHandler: GuardedWrite<DaaWorkflowExecutePayload> =
  registerMutationHandler<DaaWorkflowExecutePayload>(
    'daa_workflow_execute',
    async (ctx: MutationContext<false>, payload: DaaWorkflowExecutePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<DaaStore>({ storeId: STORE_ID, key: 'root' });
        const store: DaaStore = current ?? emptyDaaStore();

        const workflow = store.workflows[payload.workflowId];
        if (!workflow) {
          throw new Error(
            `archivist: daa_workflow_execute — workflow '${payload.workflowId}' not found in daa store`,
          );
        }

        workflow.status = 'running';

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: workflowExecuteInvariants,
      cacheScope: 'store',
    },
  );
