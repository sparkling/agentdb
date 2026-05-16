// charter: dispatch
// daa_workflow_create mutation handler (ADR-0180 Phase 5, §Architecture · Audit chain).
// Registers as `GuardedWrite<DaaWorkflowCreatePayload>` so every DAA workflow
// creation transitions through the archivist's audit chain
// (intent → applied | rejected) with guard verdicts + invariant verdicts recorded.
//
// Pre-existing CLI surface: `cli/src/mcp-tools/daa-tools.ts`
// `daa_workflow_create` handler — wraps load → mutate (store.workflows[id] =
// workflow) → save under `withDAALock` (ADR-0129 B1 — POSIX O_EXCL lockfile)
// so parallel `daa_workflow_create` + `daa_workflow_execute` invocations do
// not lost-update each other. Sibling-tool ordering: the test reproducer
// `p3-da-wf-exec` racing `p3-da-wf-create` in the same E2E_DIR was the
// motivating incident for ADR-0129 B1. The substrate's `withWrite` subsumes
// `withDAALock`; cli callsites stay in place until the dispatch boundary is
// wired through cli. This file establishes the registration shape the
// dispatch path will resolve.
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
import { workflowCreateInvariants } from '../../invariants/daa/workflow-create.js';

/** Execution strategy — matches the cli inputSchema enum (daa-tools.ts:303). */
export type DaaWorkflowStrategy = 'parallel' | 'sequential' | 'adaptive';

/**
 * Mutation payload mirroring the CLI tool's `daa_workflow_create` input shape
 * (daa-tools.ts:298-307). Defaults applied at the wire-up callsite:
 * `strategy='adaptive'`, `steps=[]`. `steps` accepts heterogeneous shapes at
 * the cli boundary (string short-form or object); the wire-up canonicalises
 * to `{ name, status: 'pending' }` per record.
 */
export interface DaaWorkflowCreatePayload {
  readonly id: string;
  readonly name: string;
  readonly steps?: ReadonlyArray<unknown>;
  readonly strategy?: DaaWorkflowStrategy;
  readonly dependencies?: Record<string, unknown>;
}

const STORE_ID = 'daa' as StoreId;

// Body ported from daa-tools.ts `daa_workflow_create` handler (lines 308-338):
// load store → canonicalise steps to `{ name, status: 'pending' }` → mint
// DAAWorkflow with defaults → store.workflows[id] = workflow → save. The cli's
// outer `withDAALock` collapses into the single `ctx.substrate.withWrite`
// because the substrate primitive owns the lock semantics (the ADR-0129 B1
// race-fix that motivated `withDAALock` — `p3-da-wf-exec` racing
// `p3-da-wf-create` — is preserved under the substrate's O_EXCL sentinel).
export const daaWorkflowCreateHandler: GuardedWrite<DaaWorkflowCreatePayload> =
  registerMutationHandler<DaaWorkflowCreatePayload>(
    'daa_workflow_create',
    async (ctx: MutationContext<false>, payload: DaaWorkflowCreatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const current = await handle.read<DaaStore>({ storeId: STORE_ID, key: 'root' });
        const store: DaaStore = current ?? emptyDaaStore();

        store.workflows[payload.id] = {
          id: payload.id,
          name: payload.name,
          status: 'pending',
          steps: (payload.steps ?? []).map((s, i) => ({
            name: typeof s === 'string' ? s : `Step ${i + 1}`,
            status: 'pending',
          })),
          strategy: payload.strategy ?? 'adaptive',
          createdAt: new Date().toISOString(),
        };

        await handle.write({ storeId: STORE_ID, key: 'root', payload: store });
      });
    },
    {
      invariants: workflowCreateInvariants,
      cacheScope: 'store',
    },
  );
