// charter: dispatch
// agentdb_causal_edge mutation handler (ADR-0181 Item 3 wire-up, 2026-05-16).
// Registers as `GuardedWrite<AgentdbCausalEdgePayload>` so every causal-edge
// recording transitions through the archivist's audit-chain
// (intent → applied | rejected) with guard verdicts + invariant verdicts
// recorded — causal-graph writes are a learning-substrate mutation
// (CausalMemoryGraph) and must not bypass MutationGuard.
//
// Pre-existing CLI surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`
// `agentdb_causal-edge` handler (line 344) — validates `sourceId` /
// `targetId` (non-empty, ≤500 chars), `relation` (non-empty, ≤200 chars),
// optional `weight` clamped via `validateScore` (default 0.5). The cli
// callsite stays in place until the dispatch boundary is wired through.
// This file establishes the registration shape the dispatch path resolves.
//
// ── ADR-0181 Item 3 — audit-vs-storage rationale (NOT a Phase-7-style handle-share collapse) ──
//
// (i) StoreId classification: 'agentdb_causal_edge' is SQLite carve-out at
//     substrate-registry.ts:118 — used here for dispatch routing and
//     audit-chain enrolment only.
//
// (ii) Actual durable write today lands in RVF via the cli router-fallback
//      (`forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts:2141-2148`,
//      controller: 'router-fallback'). The wrapping
//      `ctx.substrate.withWrite({ storeId: STORE_ID })` opens a SQLite scope
//      that the writer does NOT use — `recordCausalEdge` falls through to
//      `routeMemoryOp({ namespace: 'causal-edges' })` → RVF. The substrate
//      seam is the audit boundary; the bytes land where the cli's existing
//      pre-Phase-5 write path put them.
//
// (iii) This is NOT a Phase-7 handle-share collapse. Phase 7 (forks/ruflo
//       7d36d6f77 / forks/agentdb 4e50b4b) collapsed cli + archivist onto one
//       SQLite handle for hierarchical/reflexion/skill via
//       `getControllerRegistryAgentDb()` so reads-from-SQLite see writes-to-SQLite.
//       Item 3 cannot do that yet — `CausalMemoryGraph.addCausalEdge` takes a
//       NUMERIC `memoryId` + `memoryType` enum
//       (`'episode'|'skill'|'note'|'fact'`), but the cli tool surface is
//       string-shaped (`sourceId`/`targetId`/`relation`). The
//       string→numeric gap is ADR-0147 R7 (memory-router.ts:2106-2122 TODO):
//       wiring it requires an ADR-key→numeric-id allocator + a memoryType
//       extension + `NodeIdMapper` persistence — all out of Item 3 scope.
//       Once R7 lands, Item 3 can be revisited to do a real handle-share
//       with a literal INSERT into `causal_edges`.
//
// (iv) The b5 causalGraph probe at
//      `lib/acceptance-adr0090-b5-checks.sh:700-911` expects post-write RVF
//      visibility on namespace `'causal-edges'` (step 5b) and will FAIL
//      (not skip_accept) if the writer ever stops writing there. DO NOT
//      replace the `recordCausalEdge` → `routeCausalOp` call chain with a
//      literal SQLite INSERT into a `causal_edges` table without first
//      wiring ADR-0147 R7 (so the controller is reachable for real) AND
//      extending the probe to cold-start the SQLite `causal_edges` table
//      when running pre-controller.
//
// Type-enforcement: `ctx.substrate.withWrite` is the audit boundary; the
// CausalGraphWriter capability owns the actual write target, which today is
// RVF via the cli router-fallback (see (ii)). `cacheScope: 'namespace'`
// because causal edges are scoped to memory-namespace (per source/target
// memory ids) — global cache invalidation would over-flush.

import { registerMutationHandler } from '../../registration.js';
import type { GuardedWrite, MutationContext, StoreId } from '../../index.js';
import { causalEdgeInvariants } from '../../invariants/agentdb/causal-edge.js';

/**
 * Mutation payload mirroring the CLI tool's `agentdb_causal-edge` input shape
 * (agentdb-tools.ts:351-358). All three string fields are required at the cli
 * boundary; `weight` is optional (cli validates via `validateScore`, default
 * 0.5 when present).
 */
export interface AgentdbCausalEdgePayload {
  readonly sourceId: string;
  readonly targetId: string;
  readonly relation: string;
  readonly weight?: number;
}

const STORE_ID = 'agentdb_causal_edge' as StoreId;

export const causalEdgeHandler: GuardedWrite<AgentdbCausalEdgePayload> =
  registerMutationHandler<AgentdbCausalEdgePayload>(
    'agentdb_causal_edge',
    async (ctx: MutationContext<false>, payload: AgentdbCausalEdgePayload): Promise<void> => {
      const { sourceId, targetId, relation, weight } = payload;
      const writer = ctx.capabilities.requireCausalGraphWriter();

      await ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => {
        const result = await writer.recordEdge({ sourceId, targetId, relation, weight });

        if (result && result.success) return;
        if (
          result &&
          !result.success &&
          result.error &&
          !/not available|not wired|not initialized|missing.*method/i.test(result.error)
        ) {
          // Real controller / router error — surface verbatim for fail-loud
          // diagnosis, no silent fallback (`feedback-no-fallbacks`).
          throw new Error(`archivist: agentdb_causal_edge — CausalMemoryGraph: ${result.error}`);
        }

        // null = adapter mapped controller-not-available to null. Fail loud
        // — substrate is SQLite carve-out and the audit-vs-storage rationale
        // header (above) explains why no in-handler RVF fallback is added
        // here. With today's wiring this branch is UNREACHABLE: when
        // CausalMemoryGraph is unwired (the current state per ADR-0147 R7)
        // `recordCausalEdge` returns `controller:'router-fallback'` with
        // `success:true`, which the adapter passes through. The throw is
        // defense-in-depth for the hypothetical future where neither the
        // controller nor the router-fallback is reachable.
        throw new Error(
          'archivist: agentdb_causal_edge — CausalMemoryGraph controller not available; ' +
            'refusing silent no-op (carve-out has no RVF fallback path).',
        );
      });
    },
    {
      invariants: causalEdgeInvariants,
      cacheScope: 'namespace',
    },
  );
