// charter: dispatch
// agentdb_route mutation handler (ADR-0180 Phase 4 F4-3-callsite).
//
// SemanticRouter / LearningSystem.recommendAlgorithm is a MUTATING surface, not
// a pure read: each dispatch writes a routing decision (task → route + confidence
// + agents + controller) into the router's per-namespace history so subsequent
// calls converge on better selections via bandit/replay (B7 BanditLearner, B8
// ReflexionMemory). That trajectory write is exactly what the audit chain exists
// to capture — `intent → applied | rejected` with guard + invariant verdicts —
// so the call has to land on `GuardedWrite`, not the read-side passthrough.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-orchestration.ts`
// `routeTask(...)` (line 227) — delegates to `getController('semanticRouter')
// .route()` with a `LearningSystem.recommendAlgorithm` fallback. The Phase 4
// `TaskRouter` capability (capabilities.ts:42) adapts that path to the narrow
// surface this handler consumes — handler receives the composed `RouteDecision`
// (`{ route, confidence, agents, controller }`), never the raw controllers.
//
// Type-enforcement: `ctx.substrate.withWrite` is the only path through which
// router trajectory state may mutate. Direct fs / SQLite writes are forbidden
// by the `no-restricted-imports` backstop and the path-restricted
// substrate-internal.ts seam (ADR-0180 §Type enforcement). The RVF crate owns
// atomicity + fsync at the N-API boundary (RvfBackend.insertAsync →
// db.ingestBatch), so the JS layer adds no extra lock here.
//
// cacheScope: `'namespace'` — router decisions, BanditLearner arm statistics,
// and the ReflexionMemory recall index are all keyed by namespace, so the
// invalidation blast-radius is exactly one namespace per write.

import { randomUUID } from 'node:crypto';

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';
import type { RvfSubstrateHandle } from '../../substrates/rvf-store.js';
import { routeInvariants } from '../../invariants/agentdb/route.js';

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
const DEFAULT_NAMESPACE = 'default';

// F4-3-callsite (Phase 4 capability seam live): `agentdb_route` is the
// RVF-family (substrate-registry.ts:74) mutation that persists a routing
// decision into the router's trajectory. The two layers the F4-2 TODOs named
// map cleanly onto the two narrow capabilities (capabilities.ts):
//
//  1. Decision computation — `ctx.capabilities.requireTaskRouter().route(...)`.
//     Per `TaskRouter` JSDoc (capabilities.ts:30-40, 42-58): the capability
//     "hands `{ task, context, namespace }` in and receives the composed
//     decision `{ route, confidence, agents, controller }`" and "the
//     underlying SemanticRouter / BanditLearner updates arm statistics as a
//     side-effect of routing — that is *why* `agentdb_route` is a
//     `GuardedWrite`. The capability surface returns the decision; the
//     handler is responsible for the audited substrate write that records
//     the trajectory." Port fidelity vs cli `routeTask(...)`
//     (cli/src/mcp-tools/agentdb-orchestration.ts:227 — SemanticRouter.route
//     → LearningSystem.recommendAlgorithm fallback) is preserved by the
//     adapter wired in `ArchivistInitConfig.taskRouterFactory`, NOT by
//     reimplementing the chain inside the handler.
//
//  2. Trajectory persistence — `ctx.capabilities.requireEmbeddingScorer()
//     .embed(task)`. Per `EmbeddingScorer` JSDoc (capabilities.ts:68-92), the
//     route handler is named explicitly as a consumer of `embed(text) →
//     Float32Array` "for the RVF trajectory record" (line 74). The vector
//     becomes the key the RVF substrate writes:
//     `rvfHandle.rvf.insertAsync(id, embedding, metadata)`. The RVF crate
//     serializes ingest internally, so the JS layer adds no extra lock
//     (rvf-store.ts module header). HNSW distance math is RVF-internal — the
//     handler hands over the vector + metadata and does NOT score anything.
//
// Both capabilities are REQUIRED for a routing write: a partial dispatch (only
// router wired, no embedding) would either drop the trajectory or fall back to
// a degenerate vector — both ADR-0082 silent-failure anti-patterns. The
// `require*` accessors fail loud at the boundary when either factory is
// unsupplied, which is the correct behavior for a mutation handler that needs
// both to make a durable record.
//
// Metadata shape — the trajectory record carries the composed decision plus
// provenance so a downstream read (Phase 5+ ranked trajectory recall) can
// reconstruct `(task, namespace, route, confidence, controller, agents,
// timestamp)` without re-running the router. `context` is included when
// supplied; `namespace` defaults to `'default'` matching the cli wiring.
export const agentdbRouteHandler: GuardedWrite<AgentdbRoutePayload> =
  registerMutationHandler<AgentdbRoutePayload>(
    'agentdb_route',
    async (ctx: MutationContext<false>, payload: AgentdbRoutePayload): Promise<void> => {
      const router = ctx.capabilities.requireTaskRouter();
      const scorer = ctx.capabilities.requireEmbeddingScorer();
      const namespace = payload.namespace ?? DEFAULT_NAMESPACE;

      const decision = await router.route({
        task: payload.task,
        context: payload.context,
        namespace,
      });

      const embedding = await scorer.embed(payload.task);

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (handle) => {
        const rvfHandle = handle as RvfSubstrateHandle;
        const recordId = randomUUID();
        const metadata: Record<string, unknown> = {
          task: payload.task,
          namespace,
          route: decision.route,
          confidence: decision.confidence,
          controller: decision.controller,
          agents: [...decision.agents],
          timestamp: ctx.timestamp,
          auditId: ctx.auditId,
        };
        if (payload.context !== undefined) {
          metadata.context = payload.context;
        }
        await rvfHandle.rvf.insertAsync(recordId, embedding, metadata);
      });
    },
    {
      invariants: routeInvariants,
      cacheScope: 'namespace',
    },
  );
