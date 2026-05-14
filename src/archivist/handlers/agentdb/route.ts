// charter: dispatch
// agentdb_route mutation handler (ADR-0180 Phase 6, §Architecture · Audit chain).
//
// SemanticRouter / LearningSystem.recommendAlgorithm is a MUTATING surface, not
// a pure read: each dispatch writes a routing decision (task → route + confidence
// + agents + controller) into the router's per-namespace history so subsequent
// calls converge on better selections via bandit/replay (B7 BanditLearner, B8
// ReflexionMemory). That trajectory write is exactly what the audit chain exists
// to capture — `intent → applied | rejected` with guard + invariant verdicts —
// so the call has to land on `GuardedWrite`, not the read-side passthrough.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_route` handler (line 378) — delegates to `routeTask({ task, context })`
// which in turn calls the SemanticRouter controller and the LearningSystem
// `recommendAlgorithm` path. Per ADR-0180 §Caller surfaces, the cli callsite
// stays authoritative during the migration window; this file establishes the
// registration shape the dispatch path will resolve when the boundary is wired.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// router state may mutate. Direct fs / SQLite writes are forbidden by the
// `no-restricted-imports` backstop and the path-restricted substrate-internal.ts
// seam (ADR-0180 §Type enforcement). The substrate's O_EXCL sentinel lock
// subsumes any ad-hoc serialization the SemanticRouter performed internally.
//
// cacheScope: `'namespace'` — router decisions, BanditLearner arm statistics,
// and the ReflexionMemory recall index are all keyed by namespace, so the
// invalidation blast-radius is exactly one namespace per write.

import {
  registerMutationHandler,
  type GuardedWrite,
  type MutationContext,
  type StoreId,
} from '../../index';
import type { RvfSubstrateHandle } from '../../substrates/rvf-store';

/**
 * Mutation payload mirroring the CLI tool's `agentdb_route` input shape
 * (agentdb-tools.ts:381-388). `context` is optional free-form provenance the
 * router blends into its embedding/lookup; `namespace` lets callers route
 * within a non-default scope (defaults to `'default'` at the wire-up callsite).
 */
export interface AgentdbRoutePayload {
  readonly task: string;
  readonly context?: string;
  readonly namespace?: string;
}

const STORE_ID = 'agentdb_route' as StoreId;

// F4-2 wire-up (Phase B substrate seam live): `agentdb_route` is the RVF-family
// (substrate-registry.ts:74) mutation that persists a routing decision into the
// router's trajectory. `ctx.substrate.withWrite` resolves to the RVF substrate;
// its key/value `handle.read`/`handle.write` throw (RVF is vector-addressed,
// not whole-document), so the handler narrows to `RvfSubstrateHandle` and the
// only persistence surface is `handle.rvf` — the live `RvfBackend`.
//
// A real write here is two layers, and each layer's input is behind the
// unfinished config seam:
//
//  1. Decision computation — the cli's `routeTask(...)` runs the SemanticRouter
//     controller's `.route()` (falling back to `LearningSystem.recommendAlgorithm`)
//     to produce `{ route, confidence, agents, controller }`. Neither controller
//     is threaded through `ArchivistInitConfig` (it carries `rvfBackend` /
//     `sqliteDb` / `projectRoot` only). See TODO(F4-2-config) #1.
//  2. Trajectory persistence — appending the decision to the router's
//     per-namespace trajectory means an RVF vector record (`handle.rvf.insertAsync`)
//     keyed by the *embedding* of `payload.task`. The embedding service is also
//     not in `ArchivistInitConfig`. See TODO(F4-2-config) #2.
//
// The body inside `withWrite` THROWS rather than completing as a no-op. A
// no-op here would let the audit chain record `intent → applied` for a write
// that wrote nothing — the silent-loss anti-pattern (`feedback-data-loss-zero-
// tolerance`, `feedback-no-fallbacks`). This phase `getSubstrate('agentdb_route')`
// already throws before this body runs (RVF family, no `rvfBackend` in
// `initialize(config)` until F4-3), so the throw changes nothing now — but at
// F4-3, when the backend is threaded and `getSubstrate` stops throwing, a
// no-op body would silently record phantom writes. The throw makes a premature
// F4-3 dispatch (controller seam not yet finished) fail loud instead.
export const agentdbRouteHandler: GuardedWrite<AgentdbRoutePayload> =
  registerMutationHandler<AgentdbRoutePayload>(
    'agentdb_route',
    async (ctx: MutationContext<false>, payload: AgentdbRoutePayload): Promise<void> => {
      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const rvfHandle = handle as RvfSubstrateHandle;
        void rvfHandle.rvf; // narrowed RVF backend — the only RVF persistence surface

        // TODO(F4-2-config) #1: compute the routing decision. Needs the
        // SemanticRouter (+ LearningSystem fallback) controller instance on the
        // mutation context — `ArchivistInitConfig` threads no controller
        // registry. Port `routeTask({ task, context })` from cli
        // agentdb-orchestration.ts once the controller seam exists.
        void payload.task;
        void payload.context;
        void payload.namespace;

        // TODO(F4-2-config) #2: persist the decision into the router trajectory
        // via `rvfHandle.rvf.insertAsync(id, embedding, metadata)`. Needs the
        // embedding service to vectorize `payload.task` — also not threaded
        // through `ArchivistInitConfig`. The RVF crate owns atomicity + fsync;
        // no extra JS-side lock is added here (rvf-store.ts module header).

        throw new Error(
          'archivist: agentdb_route handler body pending F4-3 config wire-up — ' +
          'needs SemanticRouter controller + embedding service on the mutation context; ' +
          'ArchivistInitConfig threads neither (rvfBackend/sqliteDb/projectRoot only)',
        );
      });
    },
    {
      invariants: [],
      cacheScope: 'namespace',
    },
  );
