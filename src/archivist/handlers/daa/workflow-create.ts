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

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';

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

// TODO(ADR-0180 Phase 5 wire-up): port the body of daa-tools.ts
// `daa_workflow_create` callsite (load store → canonicalise steps to
// `{ name, status: 'pending' }` → mint DAAWorkflow with defaults →
// store.workflows[id] = workflow → save). The cli's outer `withDAALock`
// collapses to a single `ctx.substrate.withWrite` because the substrate
// primitive owns the lock semantics (ADR-0129 B1 race-fix preserved under
// the substrate's O_EXCL sentinel).
export const daaWorkflowCreateHandler: GuardedWrite<DaaWorkflowCreatePayload> =
  registerMutationHandler<DaaWorkflowCreatePayload>(
    'daa_workflow_create',
    async (ctx: MutationContext<false>, _payload: DaaWorkflowCreatePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        throw new Error(
          'archivist: daa_workflow_create handler body pending Phase 5 wire-up; ' +
          'callers currently route through cli/src/mcp-tools/daa-tools.ts daa_workflow_create handler',
        );
      });
    },
    {
      invariants: [], // wired by invariants-author per ADR-0180 §Mutation invariants
      cacheScope: 'store',
    },
  );
